'use strict';
const path=require('path');
const {readObj}=require('./mesh');
const {meshIndex}=require('./walk');
const DIRS=[[0,-1],[0,1],[-1,0],[1,0]];

// Keep permission walls and floor selection, and place feet on the native visible
// surface nearby. Select by height so another storey cannot become the floor.
function roomWalk(dir,meshes,types,heights){
  const terrain=meshIndex(meshes.filter(f=>f.startsWith('map')).flatMap(f=>readObj(path.join(dir,f))));
  const sample=(x,y,expected)=>{
    let best=expected,distance=0.51;
    for(const t of terrain.get(`${Math.floor(x)},${Math.floor(y)}`)||[]){
      if(Math.abs(t.det)<1e-8||/kage|shadow/i.test(t.name))continue;
      const xx=x-15.5-t.a[0],yy=y-15.5-t.a[2];
      const u=(xx*t.e2[2]-yy*t.e2[0])/t.det,v=(yy*t.e1[0]-xx*t.e1[2])/t.det;
      if(u< -1e-6||v< -1e-6||u+v>1.000001)continue;
      const h=t.a[1]+u*t.e1[1]+v*t.e2[1],delta=Math.abs(h-expected);
      if(delta<distance){best=h;distance=delta;}
    }
    return Math.round(best*1000)/1000;
  };
  const corrections=[],rows=types.length,cols=types[0].length;
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++)if(types[y][x]!=='#'){
    const previous=heights[y][x],height=sample(x,y,previous);
    if(Math.abs(previous-height)>0.02)corrections.push({tile:[x,y],permission:previous,surface:height});
    heights[y][x]=height;
  }
  const connections=types.map(row=>Array(row.length).fill(0)),stepHeights={};
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++)if(types[y][x]!=='#')for(let d=0;d<4;d++){
    const [dx,dy]=DIRS[d],xx=x+dx,yy=y+dy;
    if(xx<0||yy<0||xx>=cols||yy>=rows||types[yy][xx]==='#')continue;
    const h0=heights[y][x],h1=heights[yy][xx];
    const profile=[.25,.5,.75].map(t=>sample(x+dx*t,y+dy*t,h0+(h1-h0)*t));
    const all=[h0,...profile,h1];
    if(Math.abs(h0-h1)>1.01||all.slice(1).some((h,i)=>Math.abs(h-all[i])>.76))continue;
    connections[y][x]|=1<<d;
    if(all.some(h=>Math.abs(h-h0)>.002))stepHeights[`${x},${y},${d}`]=profile;
  }
  return {connections,stepHeights,corrections};
}
module.exports={roomWalk};
