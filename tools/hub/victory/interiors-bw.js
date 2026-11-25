'use strict';
// Black 2 map containers produce the same external room format as generation four.
const fs=require('fs'),path=require('path');
const {readNarc}=require('./ds2d');
const {readObj}=require('./mesh');
const {roomWalk}=require('./interior-walk');
const {bw2Terrain}=require('./heights');
const ROOMS=[{room:'battlestadium',zone:192},{room:'auctionhouse',zone:350},{room:'cosmetics-b2',zone:105,warp:0}];
function exportRooms(args,cartridge,helpers){
  const {run,json,model}=helpers,narc=p=>readNarc(cartridge.files.get(p));
  const headers=narc('a/0/1/2')[0],areas=cartridge.files.get('a/0/1/3');
  const matrices=narc('a/0/0/9'),lands=narc('a/0/0/8'),textures=narc('a/0/1/4');
  const bundles=narc('a/2/2/6'),propTextures=narc('a/1/7/5'),events=narc('a/1/2/6');
  const build=path.resolve(args.data,'.build/interiors');fs.mkdirSync(build,{recursive:true});
  const specs=args.rooms?JSON.parse(fs.readFileSync(args.rooms)):ROOMS,report=[];
  for(const spec of specs){
    if(!/^[-a-z0-9_]+$/.test(spec.room)||!Number.isInteger(spec.zone)||spec.zone<0||(spec.zone+1)*48>headers.length)throw Error('Invalid Black 2 room definition');
    const h=headers.subarray(spec.zone*48,(spec.zone+1)*48),area=h.readUInt16LE(2),matrix=h.readUInt16LE(4),event=h.readUInt16LE(22);
    const a=areas.subarray(area*10,area*10+10),propSet=a.readUInt16LE(0),texture=a.readUInt16LE(2);
    if(a[6]!==0)throw Error('Expected indoor area');
    const mat=matrices[matrix],cols=mat.readUInt16LE(4)*32,rows=mat.readUInt16LE(6)*32;
    if(mat.readUInt32LE(0)!==0||mat.length!==8+cols*rows/256)throw Error('Unsupported Black 2 matrix');
    const landIds=Array.from({length:cols*rows/1024},(_,i)=>mat.readInt32LE(8+i*4));
    const work=path.join(build,spec.room),dir=path.resolve(args.data,'interiors',spec.room);
    fs.mkdirSync(work,{recursive:true});fs.mkdirSync(dir,{recursive:true});
    const emit=(name,bytes)=>{if(!Buffer.isBuffer(bytes))throw Error('Missing cartridge member '+name);const file=path.join(work,name);fs.writeFileSync(file,bytes);return file;};
    const meshes=[],placed=[],materials={},heights=Array.from({length:rows},()=>Array(cols).fill(0));
    const types=Array.from({length:rows},()=>Array(cols).fill('#'));
    const convertModel=(bytes,tex,name,position=[0,0,0],rotation=[0,0,0])=>{
      const folder=fs.mkdtempSync(path.join(work,name+'-'));
      run(args.apicula,['convert',emit(name+'.nsbmd',bytes),emit(name+'.nsbtx',tex),'-o',folder,'-f','glb','--overwrite']);
      const glb=fs.readdirSync(folder).find(n=>n.endsWith('.glb'));if(!glb)throw Error('No converted model '+name);
      meshes.push(model(path.join(folder,glb),dir,name,materials,position,rotation));
    };
    for(const [cell,id] of landIds.entries()){
      if(id<0)continue;
      const b=lands[id],signature=b.toString('ascii',0,2),sections=b.readUInt16LE(2);
      if(!((signature==='WB'&&sections===3)||(signature==='GC'&&sections===4)))throw Error('Unsupported Black 2 permission container '+signature);
      const start=b.readUInt32LE(4),per=b.readUInt32LE(8),props=b.readUInt32LE(sections*4),end=b.readUInt32LE(sections*4+4);
      if(start!==sections*4+8||end!==b.length||!(start<per&&per<props&&props<end))throw Error('Invalid Black 2 map offsets');
      const ox=(cell%(cols/32))*32,oy=Math.floor(cell/(cols/32))*32;
      convertModel(b.subarray(start,per),textures[texture],'map-'+cell,[ox,0,oy]);
      const permission=b.subarray(per,b.readUInt32LE(12));
      if(permission.readUInt16LE(0)!==32||permission.readUInt16LE(2)!==32)throw Error('Invalid Black 2 permission size');
      const terrain=path.join(work,'heights-'+cell+'.json');
      emit('permissions-'+cell+'.bin',permission);
      fs.writeFileSync(terrain,bw2Terrain(permission));
      const values=JSON.parse(fs.readFileSync(terrain));
      for(let y=0;y<32;y++)for(let x=0;x<32;x++){
        const p=4+(y*32+x)*8,behavior=permission.readUInt16LE(p+4),flags=permission.readUInt16LE(p+6);
        heights[oy+y][ox+x]=values[y*32+x].reduce((a,b)=>a+b,0)/4;
        types[oy+y][ox+x]=(flags&1)||behavior===255?'#':'.';
      }
      const count=b.readUInt32LE(props),bundle=bundles[propSet],n=bundle.readUInt16LE(2);
      if(bundle.toString('ascii',0,2)!=='AB'||n%2||props+4+count*16!==end)throw Error('Invalid Black 2 building table');
      for(let i=0;i<count;i++){
        const p=props+4+i*16,id=b.readUInt16BE(p+14),position=[0,4,8].map(o=>b.readInt32LE(p+o)/65536),rotation=[0,b.readUInt16LE(p+12)*360/65536,0];
        let index=-1;
        for(let j=0;j<n/2;j++)if(bundle.readUInt16LE(bundle.readUInt32LE(4+j*4))===id)index=j;
        if(index<0)throw Error('Missing prop '+id+' in bundle '+propSet);
        const off=bundle.readUInt32LE(4+(index+n/2)*4);
        if(bundle.toString('ascii',off,off+4)!=='BMD0')throw Error('Invalid bundled model');
        convertModel(bundle.subarray(off,off+bundle.readUInt32LE(off+8)),propTextures[propSet],'furniture-'+cell+'-'+i,[position[0]+ox,position[1],(spec.propNorthPositive?-position[2]:position[2])+oy],rotation);
        placed.push({cell,id,bundle:propSet,index,position,rotation});
      }
    }
    // Read the cartridge's warp rectangles. Coordinates are DS units at tile centres.
    const ev=events[event],warpCount=ev[6],warpStart=8+ev[4]*20+ev[5]*36;
    const warp=spec.warp||0;if(warp>=warpCount)throw Error('Missing entrance warp');
    const p=warpStart+warp*20,x=ev.readUInt16LE(p+8)/16-0.5,y=ev.readUInt16LE(p+12)/16-0.5;
    const width=ev.readUInt16LE(p+14),depth=ev.readUInt16LE(p+16);
    const exits=[];for(let yy=0;yy<depth;yy++)for(let xx=0;xx<width;xx++)exits.push([x+xx,y+yy]);
    if(!exits.length||exits.some(e=>e.some(v=>!Number.isInteger(v))))throw Error('Invalid warp rectangle');
    const exitFacing=spec.exitFacing||[0,1],entry=spec.entry||[x+Math.floor(width/2)-exitFacing[0],y-exitFacing[1]];
    if(types[entry[1]]?.[entry[0]]!=='.')throw Error('Blocked Black 2 entrance '+entry);
    const {connections,stepHeights,corrections}=roomWalk(dir,meshes,types,heights);
    for(const mesh of meshes)for(const s of readObj(path.join(dir,mesh)))if(!materials[s.name])throw Error('Unmapped material '+s.name);
    const source={game:cartridge.code,zone:spec.zone,matrix,land:landIds,area,texture,propSet,event,warp,props:placed,permissionLayer:0,propNorthPositive:!!spec.propNorthPositive,floorAdjustments:corrections};
    json(path.join(dir,'materials.json'),materials);
    json(path.join(dir,'walk.json'),{cols,rows,types:types.map(r=>r.join('')),heights,connections,stepHeights,spawn:entry});
    json(path.join(dir,'room.json'),{entry,exits,exitFacing,size:[cols,rows],meshes,source,...(spec.links?{links:spec.links}:{}),...(spec.mirror?{mirror:spec.mirror}:{})});
    report.push({room:spec.room,...source});
    console.log(spec.room+': zone '+spec.zone+' -> matrix '+matrix+' -> maps '+landIds+'; area '+area+' -> texture '+texture+'; prop bundle '+propSet+'; props '+placed.length+'; event '+event+'; exit '+JSON.stringify(exits));
  }
  json(path.join(build,'sources-'+cartridge.code+'.json'),report);
}
module.exports={exportRooms};
