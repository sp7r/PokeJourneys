// Imports standalone models into a fresh hub tileset and places the landmarks.
// Run after coastal-hub.js and the terrain writer. Args: output-directory
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const out = process.argv[2];
const work = 'C:/Projects/hub-work/dsms';
const lib = path.join(work, 'app/Pokemon DS Map Studio-2.2/lib');
const cp = ['Pokemon DS Map Studio-2.2.jar','jogamp-fat.jar','graphicslib3D.jar'].map(n=>path.join(lib,n)).concat(path.join(work,'tools-build')).join(path.delimiter);
const assets = JSON.parse(fs.readFileSync(path.join(out,'assets.json'),'utf8'));
// Rebuild the asset library deterministically from the source palette each time.
fs.copyFileSync(path.join(work,'hub-tileset/JourneysHub.pdsts'),path.join(out,'JourneysHub.pdsts'));
const landmarks = JSON.parse(fs.readFileSync(path.join(out,'landmarks.json'),'utf8'));
function java(main,...args) {
  const r=spawnSync('java',['-Djava.awt.headless=true','-cp',cp,main,...args],{encoding:'utf8',maxBuffer:8e6});
  if(r.status!==0) throw Error(r.stderr || r.stdout);
  return r.stdout;
}
const list=Object.entries(assets).map(([key,a])=>[a.dir,key+'.obj',a.w,a.h].join('\t'));
const listFile=path.join(out,'model-import.txt');
fs.writeFileSync(listFile,list.join('\n'));
const imported=java('TileImport',path.join(out,'JourneysHub.pdsts'),path.join(out,'JourneysHub.pdsts'),listFile);
for(const line of imported.split('\n')) {
  const m=line.match(/^(\d+)\t(\w+)\.obj/);
  if(m) assets[m[2]].tile=+m[1];
}
const mapFile=path.join(out,'CoastalHub.pdsmap');
const lines=fs.readFileSync(mapFile,'utf8').split(/\r?\n/), chunks=[];
for(let i=0;i<lines.length;i++) {
  if(lines[i]==='mapstart') { const [x,y]=lines[i+1].trim().split(' ').map(Number); chunks.push({x,y,t:[],h:[]}); }
  if(lines[i]==='tilegrid') chunks.at(-1).t.push(i);
  if(lines[i]==='heightgrid') chunks.at(-1).h.push(i);
}
function set(x,y,layer,tile,elevation) {
  const c=chunks.find(c=>c.x===Math.floor(x/32)&&c.y===Math.floor(y/32));
  if(!c) throw Error(`Placement outside map ${x},${y}`);
  for(const [header,value] of [[c.t[layer],tile],[c.h[layer],elevation]]) {
    const row=header+1+31-y%32, cells=lines[row].trim().split(/\s+/);
    cells[x%32]=value; lines[row]=cells.join(' ')+' ';
  }
}
const cells=JSON.parse(fs.readFileSync(path.join(out,'tiles.json'),'utf8'));
for(const b of landmarks) {
  const a=assets[b.asset];
  set(Math.round(b.x-a.w/2),Math.round(b.y+a.h/2)-1,7,a.tile,b.level);
  if(b.blocking) {
    const [x0,y0,x1,y1]=b.footprint;
    for(let y=Math.max(0,Math.floor(y0));y<Math.min(cells.height,Math.ceil(y1));y++)
      for(let x=Math.max(0,Math.floor(x0));x<Math.min(cells.width,Math.ceil(x1));x++) cells.walk[y][x]=false;
  }
}
// Use the light stone tile for the promenade paths and sand for the beach interior.
for(const c of chunks) for(let y=0;y<32;y++) {
  const row=c.t[0]+1+y;
  lines[row]=lines[row].trim().split(/\s+/).map(v=>+v===1167?1181:+v===1181?1166:v).join(' ')+' ';
}
// A tiled Poké Ball medallion leaves the surrounding court clear for players.
for(let y=68;y<=84;y++) for(let x=86;x<=102;x++) {
  const radius=Math.hypot(x-94,y-76);
  if(radius>8) continue;
  const center=Math.hypot(x-94,y-76);
  const tile=radius>7 || Math.abs(y-76)<1 || (center>2&&center<3) ? 1181 : center<=2 ? 1170 : y<76 ? 1165 : 1166;
  set(x,y,0,tile,1);
}
fs.writeFileSync(mapFile,lines.join('\n'));
fs.writeFileSync(path.join(out,'collision.json'),JSON.stringify(cells));
for(const c of chunks) {
  const file=path.join(out,`CoastalHub_${String(c.x).padStart(2,'0')}_${String(c.y).padStart(2,'0')}.per`);
  const per=fs.readFileSync(file);
  for(let y=0;y<32;y++) for(let x=0;x<32;x++) per[(y*32+x)*2+1]=cells.walk[c.y*32+y][c.x*32+x]?0:128;
  fs.writeFileSync(file,per);
}
fs.writeFileSync(path.join(out,'assets.json'),JSON.stringify(assets,null,2));
console.log(java('MapPreview',path.join(out,'JourneysHub.pdsts'),mapFile,path.join(out,'preview.png'),'10'));
fs.mkdirSync(path.join(out,'export'),{recursive:true});
console.log(java('ExportObj',mapFile,path.join(out,'export/CoastalHub')));
