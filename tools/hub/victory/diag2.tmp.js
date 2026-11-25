const fs=require('fs');const {geometry}=require('../dsms/glb-to-obj');const {cornerList,transform,place}=require('./island-build');const {placements}=require('./mesh');
const rt=require('C:/Projects/hub-work/island-recipe/rom-tiles.json');const placed=placements('C:/Projects/hub-work/Frontier Terraces/DS Map Studio/FrontierTerracesAligned.pdsmap');
const insp=require('C:/Projects/hub-work/victory-island-data/.build/reference/tiles.json').tiles;
const group=process.argv[2];const idx=new Map();const key=p=>p.map(x=>Math.round(x*20)).join(',');
for(const [id,t] of Object.entries(rt)){const cs=cornerList(geometry('C:/Projects/hub-work/island-recipe/jobs/'+t.job+'/'+t.glb)).map(c=>({p:transform(c.p,t),uv:c.uv}));
 for(const p of placed.filter(x=>x.id==id)){const o=place(p);o[0]+=insp[id].offset[0];o[1]+=insp[id].offset[1];for(const c of cs){const q=c.p.map((x,i)=>x+o[i]);const k=key(q);if(!idx.has(k))idx.set(k,[]);idx.get(k).push({id,uv:c.uv,name:t.name});}}}
const L=fs.readFileSync('C:/Projects/hub-work/victory-island-data/'+group+'/'+group+'.obj','utf8').split(/\r?\n/);const v=[],vt=[];let mat='';const stats={};
for(const l of L){if(l.startsWith('v '))v.push(l.slice(2).split(' ').map(Number));else if(l.startsWith('vt '))vt.push(l.slice(3).split(' ').map(Number));else if(l.startsWith('usemtl'))mat=l.slice(7);
 else if(l.startsWith('f '))for(const c of l.slice(2).split(' ')){const [a,b]=c.split('/').map(x=>+x-1);const e=idx.get(key(v[a]));if(!e)continue;const uv=vt[b];
  const ok=e.some(x=>Math.abs(x.uv[0]-uv[0])<2e-3&&Math.abs(x.uv[1]-uv[1])<2e-3);const s=stats[mat+' '+e[0].name]||(stats[mat+' '+e[0].name]={ok:0,bad:0,ex:null});if(ok)s.ok++;else{s.bad++;if(!s.ex)s.ex=[uv,e.map(x=>x.uv).slice(0,3)];}}}
for(const [k,s] of Object.entries(stats).filter(([,s])=>s.bad).sort((a,b)=>b[1].bad-a[1].bad).slice(0,15))console.log(k,s.ok,s.bad,JSON.stringify(s.ex));
