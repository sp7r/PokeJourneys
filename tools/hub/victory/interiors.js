'use strict';
// Exports rooms from the owner's cartridges into external hub data.
const fs = require('fs'), path = require('path');
const {spawnSync} = require('child_process');
const {readRom, readNarc} = require('./ds2d');
const {convert} = require('../dsms/glb-to-obj');
const {samplePlate} = require('./walk');
const {readObj} = require('./mesh');
const {roomWalk} = require('./interior-walk');
const {plates:readPlates} = require('./heights');
const ROOMS = [
  {room:'pokemart',zone:4}, {room:'pokevault',zone:28,warp:0}, {room:'daycare',zone:437},
  {room:'battlehall',zone:563,warp:0,exitFacing:[1,0]},
  {room:'trainertower',zone:326,warp:0,exitWarps:[0,1,2]},
  {room:'villa',zone:464}, {room:'tmshop',zone:139,warp:0,exitFacing:[1,0]},
  {room:'movereminder',zone:129}, {room:'spearpillar',zone:220},
  {room:'cosmetics-veilstone',zone:140,warp:0,exitFacing:[1,0]}
];
const defaults = {
  rom:'C:/Projects/roms/Pokemon Platinum Version (US)(XenoPhobia).nds',
  data:'C:/Projects/hub-work/victory-island-data',
  apicula:'C:/Projects/Godot pokemon/tools/apicula/apicula.exe',
  lib:'C:/Projects/hub-work/dsms/app/Pokemon DS Map Studio-2.2/lib',
  java:process.env.JAVA_HOME || 'C:/Program Files/Microsoft/jdk-17.0.20.101-hotspot',
  rooms:''
};
function run(exe,args) {
  const r=spawnSync(exe,args,{encoding:'utf8',maxBuffer:1<<26});
  if(r.error || r.status!==0) throw Error(r.error || r.stdout+'\n'+r.stderr);
  return r.stdout;
}
function json(file,value){fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');}
function outside(data){
  const repo=path.resolve(__dirname,'../../..'), rel=path.relative(repo,path.resolve(data));
  if(!rel || (!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel))) throw Error('Data must be outside the repository');
}
// Locate the 24-byte zone header table by three independently identified indoor areas.
// Validate the matrix and area references below before writing any room.
function headerTable(rom){
  const begin=rom.readUInt32LE(0x20), end=begin+rom.readUInt32LE(0x2c), hits=[];
  for(let p=begin;p+438*24<end;p+=4)
    if([[4,22],[422,20],[437,22]].every(([id,area])=>rom[p+id*24]===area&&rom[p+id*24+1]===15)) hits.push(p);
  if(hits.length!==1) throw Error('Expected one Platinum zone table, found '+hits.length);
  return hits[0];
}
function matrix(buf){
  const cols=buf[0],rows=buf[1],n=cols*rows;
  let p=5+buf[4]+(buf[2]?n*2:0)+(buf[3]?n:0);
  if(!cols||!rows||p+n*2>buf.length)throw Error('Invalid room matrix');
  return {cols,rows,land:buf.readUInt16LE(p),lands:Array.from({length:n},(_,i)=>buf.readUInt16LE(p+i*2))};
}
function warps(buf){
  let p=0;
  for(const size of [20,32]){const n=buf.readUInt32LE(p);p+=4+n*size;}
  const count=buf.readUInt32LE(p);p+=4;
  return Array.from({length:count},(_,i)=>[buf.readUInt16LE(p+i*12),buf.readUInt16LE(p+i*12+2)]);
}
// Reuse the existing skinned glTF converter; undo only its tile-library centering.
// DS coordinates are 16 units per tile. This is a unit conversion, never a fitted scale.
function model(glb,dir,name,materials,position=[0,0,0],rotation=[0,0,0],scale=[1,1,1]){
  if(rotation[0]!==0||rotation[2]!==0)throw Error('Unsupported prop rotation: '+rotation);
  const info=convert(glb,dir,name,1,16,rotation[1]);
  const [x0,y0,x1,y1]=info.bounds,ox=(info.w-(x1-x0))/2-x0,oy=(info.h-(y1-y0))/2-y0;
  const file=path.join(dir,name+'.obj');
  const obj=fs.readFileSync(file,'utf8').split('\n').map(line=>{
    if(!line.startsWith('v '))return line;
    const [x,y,z]=line.slice(2).split(' ').map(Number);
    return 'v '+[(x-ox)*scale[0]+position[0],(y-oy)*scale[2]-position[2],z*scale[1]+position[1]].map(v=>v.toFixed(5)).join(' ');
  }).join('\n');
  fs.writeFileSync(file,obj);
  const bytes=fs.readFileSync(glb),gltf=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
  for(const [i,m] of (gltf.materials||[]).entries()){
    const key=name+'_'+(m.name||'m'+i).replace(/[^A-Za-z0-9_]/g,'_');
    materials[key]={lift:m.alphaMode==='BLEND'?0.002:0,transparency:m.alphaMode==='BLEND'?1:2,
      scissor:m.alphaCutoff??0.5,cull:2,shading:0,color:m.pbrMetallicRoughness?.baseColorFactor??[1,1,1,1]};
  }
  return name+'.obj';
}
// ARM9 uses backwards LZ compression in HeartGold.
function expandArm9(buf){
  const footer=buf.readUInt32LE(buf.length-8),header=footer>>>24,compressed=footer&0xffffff;
  const extra=buf.readUInt32LE(buf.length-4);
  if(header<8||header>11||compressed>buf.length||extra>0x800000)throw Error('Invalid ARM9 compression');
  const out=Buffer.alloc(buf.length+extra);buf.copy(out);
  let src=buf.length-header,dst=out.length,stop=buf.length-compressed;
  while(src>stop){
    const flags=out[--src];
    for(let mask=128;mask&&src>stop;mask>>=1){
      if(flags&mask){const hi=out[--src],lo=out[--src],len=(hi>>>4)+3,disp=((hi&15)<<8|lo)+3;
        for(let k=0;k<len;k++){--dst;if(dst<stop||dst+disp>=out.length)throw Error('Invalid ARM9 back reference');out[dst]=out[dst+disp];}
      }else out[--dst]=out[--src];
    }
  }
  if(dst!==stop)throw Error('Invalid ARM9 expansion length');
  return out;
}
function heartgoldTable(rom){
  const arm=expandArm9(rom.subarray(rom.readUInt32LE(0x20),rom.readUInt32LE(0x20)+rom.readUInt32LE(0x2c))),hits=[];
  // Independent map identities from pret/pokeheartgold map headers: New Bark,
  // Goldenrod, its Pokemon Center, and both regional Game Corner interiors.
  const known=[[60,2,0,57],[76,5,0,73],[185,26,73,178],[183,27,109,176],[536,66,286,488]];
  for(let p=0;p+537*24<=arm.length;p+=4)
    if(known.every(([zone,area,matrix,event])=>{
      const h=p+zone*24;
      return arm[h+1]===area&&(arm.readUInt16LE(h+2)&15)===15&&arm.readUInt16LE(h+4)===matrix&&arm.readUInt16LE(h+16)===event;
    }))hits.push(p);
  if(hits.length!==1)throw Error('Expected one HeartGold header table');
  console.log('HeartGold header table: expanded-arm9 0x'+hits[0].toString(16)+'; 24-byte entries; area +1, matrix +4, events +16; five map identities verified');
  return {arm,table:hits[0]};
}
function main(){
  const args={...defaults};
  for(let i=2;i<process.argv.length;i++){
    const parts=process.argv[i].replace(/^--/,'').split('=');
    if(!(parts[0] in args))throw Error('Unknown option '+parts[0]);
    args[parts[0]]=parts.length>1?parts.slice(1).join('='):process.argv[++i];
    if(!args[parts[0]])throw Error('Missing option value');
  }
  outside(args.data);
  const cartridge=readRom(args.rom);
  if(cartridge.code.startsWith('IRE'))return require('./interiors-bw').exportRooms(args,cartridge,{run,json,model});
  const hg=cartridge.code==='IPKE';
  if(!hg&&cartridge.code!=='CPUE')throw Error('Expected US Platinum or HeartGold, got '+cartridge.code);
  const narc=p=>{if(!cartridge.files.has(p))throw Error('Missing ROM file '+p);return readNarc(cartridge.files.get(p));};
  const lands=narc(hg?'a/0/6/5':'fielddata/land_data/land_data.narc'), matrices=narc(hg?'a/0/4/1':'fielddata/mapmatrix/map_matrix.narc');
  const areas=narc(hg?'a/0/4/2':'fielddata/areadata/area_data.narc'),textures=narc(hg?'a/0/4/4':'fielddata/areadata/area_map_tex/map_tex_set.narc');
  const props=narc(hg?'fielddata/build_model/bm_room.narc':'fielddata/build_model/build_model.narc'),propTextures=narc(hg?'a/0/7/0':'fielddata/areadata/area_build_model/areabm_texset.narc');
  const events=narc(hg?'a/0/3/2':'fielddata/eventdata/zone_event.narc'),headers=hg?heartgoldTable(cartridge.rom):{arm:cartridge.rom,table:headerTable(cartridge.rom)},table=headers.table;
  const build=path.resolve(args.data,'.build/interiors');fs.mkdirSync(build,{recursive:true});
  const report=[];
  // The international room (536) is the small Voltorb Flip lounge. The retained
  // Japanese Goldenrod room provides the machine-filled interior.
  const specs=args.rooms?JSON.parse(fs.readFileSync(args.rooms)):hg?[{room:'gamecorner',zone:183},{room:'namerater',zone:206},{room:'gamelounge',zone:536}]:ROOMS;
  for(const spec of specs){
    if(!Number.isInteger(spec.zone)||spec.zone<0||spec.zone>600||!/^[-a-z0-9_]+$/.test(spec.room))throw Error('Invalid room definition');
    const h=headers.arm.subarray(table+spec.zone*24,table+(spec.zone+1)*24);
    const matrixId=h.readUInt16LE(hg?4:2),m=matrix(matrices[matrixId]),areaId=h[hg?1:0],a=areas[areaId];
    const textureId=a.readUInt16LE(2),propSet=a.readUInt16LE(0),eventId=h.readUInt16LE(16),exits=warps(events[eventId]);
    if(!exits.length || (exits.length!==1 && spec.warp===undefined))throw Error('Select an entrance warp in '+spec.room);
    const selected=(spec.exitWarps||[spec.warp||0]).map(i=>exits[i]);
    const exitFacing=spec.exitFacing||[0,1];
    const cols=m.cols*32,rows=m.rows*32;
    const heights=Array.from({length:rows},()=>Array(cols).fill(0));
    const typeRows=Array.from({length:rows},()=>Array(cols).fill('#'));
    const work=path.join(build,spec.room),dir=path.resolve(args.data,'interiors',spec.room);
    fs.mkdirSync(work,{recursive:true});fs.mkdirSync(dir,{recursive:true});
    const materials={},meshes=[],placed=[];
    for(const [cell,landId] of m.lands.entries()){
      if(landId===65535)continue;
      const cellX=cell%m.cols,cellY=Math.floor(cell/m.cols),offset=[cellX*32,0,cellY*32];
      const land=lands[landId],sizes=[0,4,8,12].map(i=>land.readUInt32LE(i));
      const [permissionsSize,propsSize,modelSize,bdhcSize]=sizes,landHeader=hg?20:16;
      if(permissionsSize!==2048||propsSize%48||landHeader+sizes.reduce((a,b)=>a+b,0)!==land.length)throw Error('Invalid land sections');
      const cellWork=path.join(work,'cell-'+cell);fs.mkdirSync(cellWork,{recursive:true});
      const emit=(name,bytes)=>{const file=path.join(cellWork,name);fs.writeFileSync(file,bytes);return file;};
      const permissions=land.subarray(landHeader,landHeader+permissionsSize),propBytes=land.subarray(landHeader+permissionsSize,landHeader+permissionsSize+propsSize);
      const modelFile=emit('map.nsbmd',land.subarray(landHeader+permissionsSize+propsSize,landHeader+permissionsSize+propsSize+modelSize));
      const texFile=emit('map.nsbtx',textures[textureId]),bdhcFile=emit('map.bdhc',land.subarray(-bdhcSize));
      const converted=path.join(cellWork,'map');
      run(args.apicula,['convert',modelFile,texFile,'-o',converted,'-f','glb','--overwrite']);
      meshes.push(model(path.join(converted,fs.readdirSync(converted).find(n=>n.endsWith('.glb'))),dir,'map-'+cell,materials,offset));
      for(let p=0;p<propBytes.length;p+=48){
        const id=propBytes.readUInt32LE(p),position=[4,8,12].map(o=>propBytes.readInt32LE(p+o)/65536);
        const rotation=[16,20,24].map(o=>propBytes.readInt32LE(p+o)/4096),scale=[28,32,36].map(o=>propBytes.readInt32LE(p+o)/4096);
        const stem='prop-'+id,folder=path.join(cellWork,stem);
        run(args.apicula,['convert',emit(stem+'.nsbmd',props[id]),emit('props.nsbtx',propTextures[propSet]),'-o',folder,'-f','glb','--overwrite']);
        const name='furniture-'+cell+'-'+String(p/48).padStart(2,'0');
        meshes.push(model(path.join(folder,fs.readdirSync(folder).find(n=>n.endsWith('.glb'))),dir,name,materials,position.map((v,i)=>v+offset[i]),rotation,scale));
        placed.push({cell,id,position,rotation,scale});
      }
      const platesFile=path.join(cellWork,'plates.json');
      fs.writeFileSync(platesFile,readPlates(fs.readFileSync(bdhcFile)));
      // Cartridge plates are centred at the land cell origin (-16..16); the shared
      // sampler takes editor cell coordinates (0..32), with north-positive vertices.
      const plates=JSON.parse(fs.readFileSync(platesFile)).map(p=>({...p,x:p.x+16,y:p.y+16,
        v:p.v.map((v,i)=>v+(i%3===0?16:i%3===1?-16:0))}));
      for(let y=0;y<32;y++)for(let x=0;x<32;x++){
        const plate=samplePlate(plates,x,y);
        const blocked=!!(permissions[(y*32+x)*2+1]&0x80);

        heights[cellY*32+y][cellX*32+x]=plate?Math.round(plate.height*1000)/1000:0;
        typeRows[cellY*32+y][cellX*32+x]=blocked||!plate?'#':'.';
      }
    }
    const types=typeRows.map(row=>row.join(''));
    const {connections,stepHeights,corrections}=roomWalk(dir,meshes,types,heights);
    const entry=spec.entry||selected[0].map((v,i)=>v-exitFacing[i]);
    if(types[entry[1]][entry[0]]==='#'||selected.some(e=>types[e[1]][e[0]]==='#'))throw Error('Blocked room entrance');
    json(path.join(dir,'walk.json'),{cols,rows,types,heights,connections,stepHeights,spawn:entry});
    for(const file of meshes)for(const s of readObj(path.join(dir,file)))if(!materials[s.name])throw Error('Unmapped material '+s.name);
    json(path.join(dir,'materials.json'),materials);
    const source={game:cartridge.code,headerOffsetKind:hg?'expanded-arm9':'rom',zone:spec.zone,headerOffset:table+spec.zone*24,matrix:matrixId,land:m.lands,area:areaId,texture:textureId,propSet,event:eventId,props:placed,floorAdjustments:corrections};
    json(path.join(dir,'room.json'),{entry,exits:selected,exitFacing,size:[cols,rows],meshes,source,...(spec.links?{links:spec.links}:{}),...(spec.mirror?{mirror:spec.mirror}:{})});
    report.push({room:spec.room,...source});
    console.log(`${spec.room}: zone ${spec.zone} -> matrix ${matrixId} -> land_data ${m.lands}; area ${areaId} -> map texture ${textureId}; prop texture ${propSet}; event ${eventId}; props ${placed.length}; exit ${selected}`);
  }
  json(path.join(build,'sources-'+cartridge.code+'.json'),report);
}
if(require.main===module){try{main();}catch(e){console.error(e.stack);process.exitCode=1;}}
module.exports={headerTable,heartgoldTable,matrix,warps};
