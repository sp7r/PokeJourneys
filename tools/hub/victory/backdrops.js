// Export battle terrain from the owner's cartridges into external hub data only.
const fs = require('fs'), path = require('path');
const d = require('./ds2d'), g = require('./gba2d');
const [romDir, dataDir] = process.argv.slice(2);
if (!romDir || !dataDir) throw Error('usage: node backdrops.js <rom directory> <external hub data>');
const out = path.resolve(dataDir, 'ui/creator-backdrop');
let ancestor = out;
while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
const resolved = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, out));
const repo = fs.realpathSync(path.resolve(__dirname, '../../..'));
if (path.relative(repo, resolved).split(path.sep)[0] !== '..') throw Error('Output must be outside the repository');
function rom(name) { const f = fs.readdirSync(romDir).find(f => f.includes(name) && /\.(gba|nds)$/.test(f)); return f ? path.join(romDir, f) : null; }
function crop(im, x, y, w, h) {
  const result = d.image(w, h);
  for (let row = 0; row < h; row++) im.data.copy(result.data, row*w*4, ((y+row)*im.w+x)*4, ((y+row)*im.w+x+w)*4);
  return result;
}
function write(name, bg, base, info) {
  let left=base.w, top=base.h, right=0, bottom=0;
  for(let y=0;y<base.h;y++)for(let x=0;x<base.w;x++)if(base.data[(y*base.w+x)*4+3]) {left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);}
  if(right===0) throw Error('Empty platform: '+name);
  info.base_alpha_crop=[left,top,right-left,bottom-top];
  base=crop(base,left,top,right-left,bottom-top);
  const dir = path.join(out, name); fs.mkdirSync(dir, {recursive:true});
  fs.writeFileSync(path.join(dir, 'background.png'), d.png(bg));
  fs.writeFileSync(path.join(dir, 'base.png'), d.png(base));
  fs.writeFileSync(path.join(dir, 'info.json'), JSON.stringify({...info, background_size:[bg.w,bg.h], base_size:[base.w,base.h], base_position:[Math.floor(120-base.w/2), 145-Math.floor(base.h/2)], trainer_feet:[120,149], scale:1}, null, 2)+'\n');
  console.log(name);
}
for (const [game, title, table, terrains] of [
  ['firered','FireRed',0x24eea4,[[0,'grass'],[1,'long-grass'],[7,'cave'],[8,'indoor']]],
  ['emerald','Emerald',0x31aba8,[[0,'grass'],[4,'water']]],
]) {
  const file=rom(title); if(!file){console.log("no "+title+" cartridge: skipped");continue;} const r=fs.readFileSync(file);
  const code=r.toString('ascii',0xac,0xb0);
  if (code !== (game==='firered'?'BPRE':'BPEE') || r[0xbc] !== (game==='firered'?1:0)) throw Error('Unsupported cartridge revision');
  for (const [terrain,name] of terrains) {
    const offsets=Array.from({length:5},(_,i)=>r.readUInt32LE(table+terrain*20+i*4)-0x8000000);
    const b=offsets.map(o=>g.lz(r,o).data);
    const palette=Array(32).fill([0,0,0]).concat(g.pal(b[4],0,48));
    const full=g.map(b[1],b[0],palette,240,112), bg=d.image(240,112), base=d.image(128,48);
    // These GBA maps bake both platforms into the same layer. Separate the complete foe
    // platform by its difference from the modal scanline colour; retain the original too.
    for(let y=0;y<112;y++) {
      const counts=new Map();
      for(let x=0;x<240;x++){let c=full.data.readUInt32LE((y*240+x)*4);counts.set(c,(counts.get(c)||0)+1);}
      const color=[...counts].sort((a,b)=>b[1]-a[1])[0][0];
      for(let x=0;x<240;x++) bg.data.writeUInt32LE(color,(y*240+x)*4);
      if(y>=36&&y<84)for(let x=112;x<240;x++) {
        let c=full.data.readUInt32LE((y*240+x)*4);
        if(c!==color)base.data.writeUInt32LE(c,((y-36)*128+x-112)*4);
      }
    }
    write(game+'-'+name,bg,base,{source:file,code,revision:r[0xbc],table:'0x'+table.toString(16),terrain,offsets:Object.fromEntries(['tiles','map','entry_tiles','entry_map','palette'].map((k,i)=>[k,'0x'+offsets[i].toString(16)])),base_side:'foe',base_source_rect:[112,36,128,48],background_note:'Native 240x112 battle view; platforms separated by modal scanline colour. Original retained in battle.png.'});
    fs.writeFileSync(path.join(out,game+'-'+name,'battle.png'),d.png(full));
  }
}
function palette(buf) {
  // Some palettes omit unused banks and describe their indices in a following PMCP block.
  const b=Buffer.from(buf); b.writeUInt32LE(Math.min(b.readUInt32LE(32),b.readUInt32LE(20)-24),32);
  return d.readNclr(b);
}
for(const [game,title,bgArc,objArc,palStart] of [
  ['platinum','Platinum','battle/graphic/pl_batt_bg.narc','battle/graphic/pl_batt_obj.narc',172],
  ['heartgold','HeartGold','a/0/0/7','a/0/0/8',176],
]) {
  const file=rom(title); if(!file){console.log("no "+title+" cartridge: skipped");continue;} const r=d.readRom(file), rawBg=d.readNarc(r.files.get(bgArc)), rawObj=d.readNarc(r.files.get(objArc)), bg=rawBg.map(d.decompress), obj=rawObj.map(d.decompress);
  for(const [name,bgIndex,charIndex,palIndex] of [['grass-day',0,130,1],['field-day',0,136,7]]) {
    const scr=d.readNscr(bg[2]); scr.width=256;scr.height=256;scr.entries=scr.entries.slice(0,1024);
    const image=d.renderScreen(scr,d.readNcgr(bg[3+bgIndex]),palette(bg[palStart+bgIndex*3]));
    const cells=d.readNcer(obj[131]);
    const base=d.renderCell(cells.cells[0],d.readNcgr(obj[charIndex]),palette(obj[palIndex]),cells.mapping);
    const offsets=(a,indices)=>Object.fromEntries(indices.map(i=>[i,'0x'+(a[i].byteOffset-r.rom.byteOffset).toString(16)]));
    write(game+'-'+name,crop(image,0,0,256,128),base,{source:file,code:r.code,time:'day',background:{archive:bgArc,tiles:3+bgIndex,map:2,palette:palStart+bgIndex*3,rom_offsets:offsets(rawBg,[3+bgIndex,2,palStart+bgIndex*3]),screen_block:0,crop:[0,0,256,128]},base:{archive:objArc,tiles:charIndex,palette:palIndex,cells:131,rom_offsets:offsets(rawObj,[charIndex,palIndex,131]),cell:0},base_side:'foe'});
  }
}
