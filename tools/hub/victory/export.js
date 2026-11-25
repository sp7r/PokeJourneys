'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { spawnSync } = require('child_process');
const { readObj, placements } = require('./mesh');
const repo = path.resolve(__dirname, '../../..');
const defaults = {
 map: 'C:/Projects/hub-work/Frontier Terraces/DS Map Studio/FrontierTerracesAligned.pdsmap',
 reference: 'C:/Projects/hub-work/Frontier Terraces/Godot', data: 'C:/Projects/hub-work/victory-island-data',
 lib: process.env.DSMS_LIB || 'C:/Projects/hub-work/dsms/app/Pokemon DS Map Studio-2.2/lib',
 java: process.env.JAVA_HOME || 'C:/Program Files/Microsoft/jdk-17.0.20.101-hotspot', godot: process.env.GODOT || ''
};
function options() {
 const out = {...defaults};
 for(let i=2;i<process.argv.length;i++) {
  const key=process.argv[i].replace(/^--/,'');
  if(!(key in out)||!process.argv[i+1])throw Error('Unknown or incomplete option: '+process.argv[i]);
  out[key]=path.resolve(process.argv[++i]);
 }
 if(!out.godot){const packages=path.join(process.env.LOCALAPPDATA||'','Microsoft/WinGet/Packages');
  for(const dir of fs.existsSync(packages)?fs.readdirSync(packages):[])if(dir.startsWith('GodotEngine.GodotEngine_')){
   const exe=fs.readdirSync(path.join(packages,dir)).find(n=>/^Godot_v4\.7.*console\.exe$/.test(n));
   if(exe)out.godot=path.join(packages,dir,exe);
  }
 }
 if(!out.godot)throw Error('Set GODOT or pass --godot <Godot 4.7 executable>');return out;
}
function run(command,args,env){const r=spawnSync(command,args,{stdio:'inherit',env:env||process.env});if(r.error)throw r.error;if(r.status!==0)throw Error(path.basename(command)+' exited '+r.status);}
function json(file,value){fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');}
function digest(files){const h=crypto.createHash('sha256');for(const file of files)h.update(fs.readFileSync(file));return h.digest('hex');}
function classify(tiles,reference,hashes){
 const byName=new Map(),byHash=new Map();
 for(const [group,surfaces]of Object.entries(reference))for(const s of surfaces){
  const name=s.name.replace(/^GroundShadow(?:Solid|Native)_/,'').toLowerCase();
  if(!byName.has(name))byName.set(name,new Set());byName.get(name).add(group);
  const hash=hashes[s.texture];if(!byHash.has(hash))byHash.set(hash,new Set());byHash.get(hash).add(group);
 }
 return tiles.map(tile=>{
  const votes={terrain:0,buildings:0,decorations:0};
  for(const tex of tile.textures){const groups=byName.get(path.parse(tex.name).name.toLowerCase())||byHash.get(tex.hash);if(groups&&groups.size===1)votes[[...groups][0]]++;}
  const sorted=Object.keys(votes).sort((a,b)=>votes[b]-votes[a]);let group=sorted[0],inferred=false;
  if(!votes[group]){inferred=true;group=/ship|yacht|house|build|shop|dome|tower|stadium|league|gym|gate/i.test(tile.name)?'buildings':/tree|flower|grass_small|bush|rock|fence|bench|lamp|board|sign|parasol|vender|plant|ornament|c04_poke|cyclepoint/i.test(tile.name)?'decorations':'terrain';}
  return {...tile,group,inferred};
 });
}
function main(){
 const args=options(),data=path.resolve(args.data),rel=path.relative(repo,data);
 if(!rel||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel)))throw Error('Data must be outside the repository');
 const build=path.join(data,'.build'),inspection=path.join(build,'reference'),probe=path.join(build,'probe');
 for(const dir of [build,inspection,probe])fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(probe,'project.godot'),'config_version=5\n');
 const cp=['Pokemon DS Map Studio-2.2.jar','jogamp-fat.jar','graphicslib3D.jar'].map(n=>path.join(args.lib,n)).join(path.delimiter)+path.delimiter+build;
 const java=path.join(args.java,'bin/java.exe'),javac=path.join(args.java,'bin/javac.exe');
 run(javac,['-nowarn','-cp',cp,'-d',build,path.join(repo,'tools/hub/dsms/ExportObj.java'),...['InspectTiles.java','ExportVictory.java','ExportHeights.java'].map(n=>path.join(__dirname,n))]);
 const mapLines=fs.readFileSync(args.map,'utf8').split(/\r?\n/),tileset=path.join(path.dirname(args.map),mapLines[mapLines.indexOf('tileset')+1].trim());
 const textureFiles=fs.readdirSync(path.dirname(tileset)).filter(n=>/\.png$/i.test(n)).sort().map(n=>path.join(path.dirname(tileset),n));
 const inspectKey=digest([tileset,...textureFiles,...['terrain','buildings','decorations'].map(n=>path.join(args.reference,'data',n+'.res')),path.join(__dirname,'InspectTiles.java'),path.join(__dirname,'inspect-reference.gd')]);
 const cacheKey=path.join(inspection,'key.txt'),tileFile=path.join(inspection,'tiles.json');
 if(!fs.existsSync(cacheKey)||fs.readFileSync(cacheKey,'utf8')!==inspectKey||!fs.existsSync(tileFile)){
  run(args.godot,['--headless','--path',probe,'--script',path.join(__dirname,'inspect-reference.gd'),'--',args.reference,inspection],{...process.env,APPDATA:build,LOCALAPPDATA:build});
  run(java,['-Djava.awt.headless=true','-cp',cp,'InspectTiles',tileset,tileFile,inspection]);fs.writeFileSync(cacheKey,inspectKey);
 }
 const inspected=JSON.parse(fs.readFileSync(tileFile)),reference=JSON.parse(fs.readFileSync(path.join(inspection,'reference-meshes.json')));
 const tiles=classify(inspected.tiles,reference,inspected.reference),placed=placements(args.map),groups=path.join(build,'groups.tsv');
 fs.writeFileSync(groups,tiles.map(t=>t.id+'\t'+t.group).join('\n')+'\n');
 // A terrain tile whose model runs past its footprint overlaps the next copy at the same height and
 // flickers. Only boardwalk tiles are split this way; lifting sand or paths shows seams at their edges.
 const overflow=t=>t.group==='terrain'&&t.textures.some(x=>/hashi|bridge/i.test(x.name))&&(t.bounds[0][0]<-.01||t.bounds[0][1]>t.width+.01||t.bounds[1][0]<-.01||t.bounds[1][1]>t.height+.01);
 // Extent of a copy in map tiles: x grows east; the model's y grows north, so rows run backwards.
 const extent=p=>{const t=tiles[p.id];return {x0:p.tile[0]+t.bounds[0][0],x1:p.tile[0]+t.bounds[0][1],y0:p.tile[1]+1-t.bounds[1][1],y1:p.tile[1]+1-t.bounds[1][0],h:p.height};};
 const copies=placed.filter(p=>overflow(tiles[p.id])).map(p=>({p,e:extent(p)})).sort((a,b)=>a.e.y0-b.e.y0||a.e.x0-b.e.x0);
 const overlaps=(a,b)=>a.h===b.h&&a.x0<b.x1-.01&&b.x0<a.x1-.01&&a.y0<b.y1-.01&&b.y0<a.y1-.01;
 // Each copy takes the lowest level no copy it overlaps already uses: 0 ground, 1 deck, 2 deck2.
 const deckFile=path.join(build,'deck.tsv'),deck=[];
 // Tiles that fit their footprint stay on the ground and count as already placed.
 const ground=placed.filter(p=>tiles[p.id].group==='terrain'&&!overflow(tiles[p.id])).map(p=>({p,e:extent(p)}));
 const raised=[];
 for(const c of copies){const used=new Set([...ground.filter(g=>overlaps(g.e,c.e)).map(()=>0),...raised.filter(r=>overlaps(r.e,c.e)).map(r=>r.level)]);c.level=[0,1,2].find(l=>!used.has(l))??2;if(c.level)raised.push(c),deck.push(c);else ground.push(c);}
 fs.writeFileSync(deckFile,deck.map(({p,level})=>{const mx=Math.floor(p.tile[0]/32),my=Math.floor(p.tile[1]/32);return [level,mx,my,p.layer,p.tile[0]-mx*32,31-(p.tile[1]-my*32)].join(' ');}).join('\n')+'\n');
 const meshKey=digest([args.map,tileset,...textureFiles,groups,deckFile,path.join(__dirname,'ExportVictory.java'),path.join(repo,'tools/hub/dsms/ExportObj.java')]);
 const cacheFile=path.join(build,'mesh-cache.json');
 const previous=fs.existsSync(cacheFile)?JSON.parse(fs.readFileSync(cacheFile)):null;
 const cached=previous?.key===meshKey&&Object.entries(previous.files).every(([name,hash])=>fs.existsSync(path.join(data,name))&&digest([path.join(data,name)])===hash);
 if(!cached){
 for(const group of ['terrain','buildings','decorations','deck','deck2']){const target=path.resolve(data,group);if(path.dirname(target)!==data)throw Error('Mesh output escapes data folder');fs.rmSync(target,{recursive:true,force:true});}
 run(java,['-Djava.awt.headless=true','-cp',cp,'ExportVictory',args.map,data,groups,path.join(data,'cells.json'),deckFile]);
  const files={};
  for(const group of ['terrain','buildings','decorations','deck','deck2'])for(const name of fs.readdirSync(path.join(data,group)).sort()){
   if(!/\.(obj|mtl|png)$/i.test(name))continue;
   files[group+'/'+name]=digest([path.join(data,group,name)]);
  }
  files['cells.json']=digest([path.join(data,'cells.json')]);
  json(cacheFile,{key:meshKey,files});
 }else console.log('Mesh cache matches source and output hashes');
 run(java,['-Djava.awt.headless=true','-cp',cp,'ExportHeights',args.map,path.join(build,'plates.json')]);
 const meshes=Object.fromEntries(['terrain','buildings','decorations','deck','deck2'].map(g=>[g,readObj(path.join(data,g,g+'.obj'))]));json(path.join(build,'meshes.json'),meshes);
 writeMaterials(data,meshes,reference,inspected);
 const layout=JSON.parse(fs.readFileSync(path.join(repo,'hub/victory/data/layout.json')));
 const signs=placed.filter(p=>tiles[p.id].textures.some(t=>/sign01|sign02|c15_sign_01|c03_kanban|board_a/i.test(t.name))||/(?:sign|kanban|chart_board|board_a)/i.test(tiles[p.id].name))
  .map(p=>({tile:p.tile,facing:/(?:_r90|_l\.)/i.test(tiles[p.id].name)?null:'down',label:'',width:tiles[p.id].width,tileId:p.id,model:tiles[p.id].name}));
 signs.sort((a,b)=>a.tile[1]-b.tile[1]||a.tile[0]-b.tile[0]||a.tileId-b.tileId);json(path.join(data,'signs.json'),signs);
 const {buildWalk}=require('./walk');
 const {walk,diagnostics}=buildWalk({plates:JSON.parse(fs.readFileSync(path.join(build,'plates.json'))),cells:JSON.parse(fs.readFileSync(path.join(data,'cells.json'))),meshes:{...meshes,terrain:[...meshes.terrain,...meshes.deck,...meshes.deck2],deck:[],deck2:[]},mapFile:args.map,layout,treeTiles:placed.filter(p=>tiles[p.id].textures.some(t=>/^ki0[0-9]/i.test(t.name))).map(p=>({x0:p.tile[0],x1:p.tile[0]+tiles[p.id].width-1,y0:p.tile[1]-tiles[p.id].height+1,y1:p.tile[1]}))});
 json(path.join(data,'walk-diagnostics.json'),diagnostics);
 json(path.join(data,'walk.json'),walk);fs.mkdirSync(path.join(data,'sprites'),{recursive:true});
 fs.copyFileSync(path.join(args.reference,'data/sprites/hero.png'),path.join(data,'sprites/hero.png'));fs.copyFileSync(path.join(args.reference,'data/sprites.json'),path.join(data,'sprites.json'));
 const counts={terrain:0,buildings:0,decorations:0};for(const p of placed)counts[tiles[p.id].group]++;
 const inferred=[...new Set(placed.map(p=>p.id))].filter(id=>tiles[id].inferred).sort((a,b)=>a-b);
 const report=['Victory Island export','Source: '+path.resolve(args.map),`Grid: ${walk.cols} x ${walk.rows}; gameindex 2; native mesh scale 1:1`,'Tile placements per group: '+JSON.stringify(counts),'Spawn tile: '+JSON.stringify(layout.spawn),'Signs found: '+signs.length,...signs.map(s=>`  ${s.tile.join(',')} ${s.model} facing ${s.facing||'unknown'}`),'Groups inferred for textures absent from the reference: '+inferred.map(id=>`${id} ${tiles[id].name} -> ${tiles[id].group}`).join('; '),'Height/collision diagnostics: missing floors '+diagnostics.missingHeight.length+'; unknown behaviours '+JSON.stringify(diagnostics.unknownBehaviours)+'; stale height corrections '+diagnostics.staleHeightCorrections.length, ...diagnostics.staleHeightCorrections.map(c=>'  '+c.tile.join(',')+': stale plate '+c.plate+' -> visible terrain '+c.terrain+(c.blocked?' (blocked)':'')), 'Full collision diagnostics: walk-diagnostics.json','Doorway markers retained from the reference (outside standing tiles):',...layout.doorways.map(d=>`  ${d.name}: ${d.tile.join(',')}; ${walk.types[d.tile[1]][d.tile[0]]}; nearest building anchor ${nearestBuilding(d.tile,placed,tiles)}`),...doorwayChanges(placed,tiles), ...geometryChanges(meshes,reference), 'All original marker positions are retained. Source geometry is authoritative; no models are rescaled. See compare/ for visual comparisons.'];
 fs.writeFileSync(path.join(data,'export-report.txt'),report.join('\n')+'\n');json(path.join(build,'tile-groups.json'),tiles.map(t=>({id:t.id,name:t.name,group:t.group,inferred:t.inferred})));
 console.log('Data written to '+data);console.log('Meshes: '+JSON.stringify(counts)+'; signs: '+signs.length+'; spawn: '+layout.spawn.join(','));console.log('Report: '+path.join(data,'export-report.txt'));
}

function writeMaterials(data,meshes,reference,inspected){
 const seeThrough=JSON.parse(fs.readFileSync(path.join(repo,"hub/victory/data/layout.json"))).seeThrough;
 const textureHashes=new Map(inspected.tiles.flatMap(t=>t.textures).map(t=>[path.parse(t.name).name.toLowerCase(),t.hash]));
 for(const [group,surfaces]of Object.entries(meshes)){
  const config={};
  for(const s of surfaces){
   const name=s.name.toLowerCase(), hash=textureHashes.get(name);
   const refs=reference[group]||reference.terrain;
   const match=refs.find(r=>r.name.toLowerCase()===name)||refs.find(r=>inspected.reference[r.texture]===hash);
   // layout.json "seeThrough": materials drawn blended, such as glass, instead of cut out.
   const shadow=/shade|kage|shadow/i.test(name)||(seeThrough||[]).includes(s.name);
   config[s.name]={lift:group==='deck'?0.012:group==='deck2'?0.02:/^(sea|ike01$)/i.test(name)?0:0.004,transparency:shadow?1:(match?.transparency??2),priority:/^shade/i.test(name)?-2:(match?.priority??0),scissor:match?.scissor??0.5,cull:match?.cull??2,shading:match?.shading??0};
  }
  json(path.join(data,group,'materials.json'),config);
 }
}


function doorwayChanges(placed,tiles){
 const expected={BattleStadium:/c5_wbt_01_aligned/,BattleDome:/c04tcourt_01_aligned/,PokeMart:/PT_005_fs_aligned/,BattleTower:/PT_014_c1_s03|tower_aligned/,WhiteMarketShop:/PT_454_r213s01_aligned/,PurpleMarketShop:/HG_079_ko_game_aligned/,TentShop:/HG_087_ko_seimei_aligned/,PhotoShop:/HG_105_tn_photo_aligned/,GreenMarketShop:/B2_056_c5_rbuild_01_aligned/,GoldMarketShop:/B2_058_c5_rbuild_03_aligned/,Shrine:/B2_089_c8_lbuildw_02_aligned/,Daycare:/B2_137_tt_house01_aligned/};
 return Object.entries(expected).map(([name,re])=>{const found=placed.filter(p=>re.test(tiles[p.id].name));return '  '+name+': '+(found.length?found.map(p=>tiles[p.id].name+' at '+p.tile.join(',')).join('; '):'reference building model is not placed in newest map; marker retained');});
}
function geometryChanges(meshes,reference){
 const bounds=s=>[0,1,2].map(k=>s.vertices.reduce((a,v)=>[Math.min(a[0],v[k]),Math.max(a[1],v[k])],[Infinity,-Infinity]));
 const result=['Source/reference translations for surfaces retaining the same dimensions (XYZ=east/up/south; excludes .004 display lift):'];
 for(const [group,ss]of Object.entries(meshes))for(const s of ss){
  const r=(reference[group]||[]).find(r=>r.name===s.name);if(!r)continue;
  const a=bounds(s),b=bounds(r);if(!a.every((v,k)=>Math.abs(v[1]-v[0]-(b[k][1]-b[k][0]))<.005))continue;
  const delta=a.map((v,k)=>Math.round((v[0]-b[k][0]+(k===1&& !/^(sea|ike01$)/i.test(s.name)?.004:0))*1000)/1000);
  if(delta.some(x=>Math.abs(x)>.01))result.push('  '+s.name+': '+JSON.stringify(delta));
 }
 return result;
}

function nearestBuilding(tile,placed,tiles){const candidates=placed.filter(p=>tiles[p.id].group==='buildings').sort((a,b)=>Math.hypot(a.tile[0]-tile[0],a.tile[1]-tile[1])-Math.hypot(b.tile[0]-tile[0],b.tile[1]-tile[1]));return candidates.length?`${tiles[candidates[0].id].name} at ${candidates[0].tile.join(',')}`:'none';}
if(require.main===module){try{main();}catch(e){console.error(e.stack);process.exitCode=1;}}
module.exports={classify};
