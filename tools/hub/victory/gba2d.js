const d=require('./ds2d.js'),fs=require('fs');
// Decode only the supplied cartridge; generated assets belong in external hub data.
function pal(b,o,n=16){return Array.from({length:n},(_,i)=>{let v=b.readUInt16LE(o+i*2);return [v&31,v>>5&31,v>>10&31].map(x=>Math.round(x*255/31));});}
function lz(b,o){if(b[o]!==16)throw Error('Not LZ77');let len=b.readUIntLE(o+1,3);if(len>65536||len<16)throw Error('size');let out=Buffer.alloc(len),i=o+4,j=0;while(j<len){if(i>=b.length)throw Error('EOF');let f=b[i++];for(let bit=7;bit>=0&&j<len;bit--){if(f>>bit&1){let a=b[i++],c=b[i++],n=(a>>4)+3,dist=((a&15)<<8|c)+1;if(dist>j)throw Error('distance');for(let t=0;t<n&&j<len;t++,j++)out[j]=out[j-dist];}else out[j++]=b[i++];}}return{data:out,end:i};}
function tiles(b,p,cols,transparent=false){let n=Math.floor(b.length/32),im=d.image(cols*8,Math.ceil(n/cols)*8);for(let t=0;t<n;t++)for(let y=0;y<8;y++)for(let x=0;x<8;x++){let v=b[t*32+y*4+(x>>1)]>>((x&1)*4)&15;d.put(im,(t%cols)*8+x,Math.floor(t/cols)*8+y,p[v]||p[0],transparent&&v===0?0:255);}return im;}
function solid(w,h,c){let im=d.image(w,h);for(let y=0;y<h;y++)for(let x=0;x<w;x++)d.put(im,x,y,c);return im;}
function blit(dst,src,x,y){for(let yy=0;yy<src.h;yy++)for(let xx=0;xx<src.w;xx++){let i=(yy*src.w+xx)*4;if(src.data[i+3])d.put(dst,x+xx,y+yy,[...src.data.subarray(i,i+3)],src.data[i+3]);}}
function scale(im,n=3){let o=d.image(im.w*n,im.h*n);for(let y=0;y<o.h;y++)for(let x=0;x<o.w;x++){let i=(Math.floor(y/n)*im.w+Math.floor(x/n))*4;d.put(o,x,y,[...im.data.subarray(i,i+3)],im.data[i+3]);}return o;}
function save(file,im){fs.writeFileSync(file,d.png(im));}
function map(b,t,p,w=240,h=160,transparent=false){let im=d.image(w,h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){let e=b.readUInt16LE((Math.floor(y/8)*32+Math.floor(x/8))*2),xx=e&1024?7-x%8:x%8,yy=e&2048?7-y%8:y%8,idx=t[(e&1023)*32+yy*4+(xx>>1)]>>((xx&1)*4)&15;d.put(im,x,y,p[(e>>12)*16+idx]||p[idx],transparent&&idx===0?0:255);}return im;}
const path=require('path');
const CODES={' ':0,'!':0xab,'?':0xac,'.':0xad,',':0xb8,'/':0xba,':':0xf0,'-':0xae,"'":0xb4,'’':0xb4,'‘':0xb3,'“':0xb1,'”':0xb2,'…':0xb0,'é':0x1b,'É':6,'(':0x5c,')':0x5d,'+':0x2e,'=':0x35,'&':0x2d,';':0x36,'%':0x5b,'▶':0xef,'♂':0xb5,'♀':0xb6};
for(let i=0;i<26;i++){CODES[String.fromCharCode(65+i)]=0xbb+i;CODES[String.fromCharCode(97+i)]=0xd5+i;}
for(let i=0;i<10;i++)CODES[String(i)]=0xa1+i;
function glyph(r,base,c,x,y){return r.readUInt16LE(base+c*64+((y>>3)*2+(x>>3))*16+(y&7)*2)>>(14-(x&7)*2)&3;}
function exportFont(r,out,name,base,widths,p,fg,sh){
 const chars=Object.entries(CODES),atlas=d.image(256,Math.ceil(chars.length/16)*16),lines=[];
 chars.forEach(([ch,c],i)=>{let ox=i%16*16,oy=Math.floor(i/16)*16;
 for(let y=0;y<16;y++)for(let x=0;x<16;x++){let v=glyph(r,base,c,x,y);if(v===1||v===2)d.put(atlas,ox+x,oy+y,p[v===1?fg:sh]);}
 lines.push(`char id=${ch.codePointAt(0)} x=${ox} y=${oy} width=16 height=16 xoffset=0 yoffset=0 xadvance=${r[widths+c]} page=0 chnl=15`);});
 save(path.join(out,name+'.png'),atlas);
 fs.writeFileSync(path.join(out,name+'.fnt'),['info face="FireRed" size=16 bold=0 italic=0 unicode=1 stretchH=100 smooth=0 aa=1 padding=0,0,0,0 spacing=0,0',`common lineHeight=16 base=13 scaleW=${atlas.w} scaleH=${atlas.h} pages=1 packed=0`,`page id=0 file="${name}.png"`,`chars count=${lines.length}`,...lines,''].join('\n'));
}
function run(){
 const [game,file,root]=process.argv.slice(2);
 if(game!=='firered'||!file||!root)throw Error('usage: node tools/hub/victory/gba2d.js firered <FireRed .gba> <hub data dir>');
 const r=fs.readFileSync(file),code=r.toString('ascii',0xac,0xb0),revision=r[0xbc];
 if(code!=='BPRE'||revision!==1)throw Error(`Unsupported cartridge: ${code}, revision ${revision}. Only English FireRed BPRE Rev 1 is supported; nothing written.`);
 if(r.length<0xe99118)throw Error('Truncated FireRed Rev 1 cartridge; nothing written.');
 const out=path.resolve(root,'ui/firered'),repo=fs.realpathSync(path.resolve(__dirname,'../../..')).toLowerCase();
 let ancestor=out;
 while(!fs.existsSync(ancestor))ancestor=path.dirname(ancestor);
 const resolved=path.resolve(fs.realpathSync(ancestor),path.relative(ancestor,out)).toLowerCase();
 if(resolved===repo||resolved.startsWith(repo+path.sep))throw Error('Export destination must be outside the repository; nothing written.');
 const mp=pal(r,0x47196c),dp=pal(r,0x471e4c),np=pal(r,0xe98024,96),kp=pal(r,0xe97fe4);
 const nt=lz(r,0xe980e4).data,maps=[0xe982bc,0xe98398,0xe98458,0xe98518].map(o=>lz(r,o).data);
 if(nt.length!==0x600||maps.some(m=>m.length!==0x500))throw Error('Unexpected naming data; nothing written.');
 fs.mkdirSync(out,{recursive:true});
 save(path.join(out,'message-sheet.png'),tiles(r.subarray(0x41f238,0x41f4b8),dp,5,true));
 save(path.join(out,'menu.png'),tiles(r.subarray(0x470dcc,0x470eec),mp,3,true));
 const arrow=d.image(16,16);
 for(let y=0;y<16;y++)for(let x=0;x<16;x++){let v=glyph(r,0x1ff370,0xef,x,y);if(v===1||v===2)d.put(arrow,x,y,mp[v===1?2:3]);}
 save(path.join(out,'arrow.png'),arrow);
 exportFont(r,out,'font',0x1ff370,0x207370,mp,2,3);
 exportFont(r,out,'naming-font',0x1f3170,0x1fb170,kp,1,2);
 const names=['background','upper','lower','others'];
 maps.forEach((m,i)=>save(path.join(out,'naming-'+names[i]+'.png'),map(m,nt,np,240,160,i>0)));
 const sprites=[['back',0xe98858,0x1e0,5,4,184,104],['ok',0xe98a38,0x1e0,5,4,184,128],['pageFrame',0xe985d8,0x280,5,4,184,72],['pageButton',0xe98fd8,0x100,4,2,188,75],['pageUpperText',0xe98c18,0x60,3,4,192,80],['pageLowerText',0xe98cb8,0x60,3,4,192,80],['pageOthersText',0xe98d58,0x60,3,4,192,80],['cursor',0xe98df8,0x80,2,5,30,80],['inputArrow',0xe990d8,0x20,1,3,93,52],['underscore',0xe990f8,0x20,1,3,97,56]];
 for(const [name,bank] of [['pageButtonUpper',1],['pageButtonOthers',3]]) save(path.join(out,name+'.png'),tiles(r.subarray(0xe98fd8,0xe990d8),np.slice(bank*16,bank*16+16),4,true));
 const positions={};
 for(const [n,o,size,cols,bank,x,y]of sprites){save(path.join(out,n+'.png'),tiles(r.subarray(o,o+size),np.slice(bank*16,bank*16+16),cols,true));positions[n]=[x,y];}
 fs.writeFileSync(path.join(out,'metadata.json'),JSON.stringify({game:code,revision,size:[240,160],messagePalette:dp,menuPalette:mp,namingPalette:np,keyboardPalette:kp,positions,title:[72,32,128,16],input:[64,48,112,16],nameStart:[100,49],nameAdvance:8,keyX:[35,47,59,91,103,115,127,159],symbolX:[35,57,79,101,123,145],rowY:[81,97,113,129],cursorBlend:[12,8,16]},null,2));
 console.log('FireRed BPRE Rev 1 UI exported to '+out);
}
if(require.main===module){try{run();}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={pal,lz,tiles,map,glyph,CODES};
