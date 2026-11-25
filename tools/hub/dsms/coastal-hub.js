// Builds a new coastal hub layout from the illustrated island plan.
// Usage: node coastal-hub.js output-directory
// Assets are converted separately into output-directory/models and described in assets.json.
const fs = require('fs');
const path = require('path');
const out = process.argv[2];
const assets = JSON.parse(fs.readFileSync(path.join(out, 'assets.json'), 'utf8'));
const width = 160, height = 128;
const ground = Array.from({ length: height }, () => Array(width).fill('sea'));
const level = Array.from({ length: height }, () => Array(width).fill(0));
const buildings = [], decks = [], trees = [], fences = [];
const ellipse = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
function polygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[i], [bx, by] = points[j];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}
function paint(test, material, elevation) {
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!test(x + 0.5, y + 0.5)) continue;
    ground[y][x] = material;
    if (elevation !== undefined) level[y][x] = elevation;
  }
}
const town = [[27,64],[33,59],[41,62],[49,66],[67,66],[79,62],[91,59],[101,62],[116,62],[127,68],[136,74],[141,67],[148,65],[153,70],[151,77],[143,81],[140,87],[145,95],[146,106],[53,106],[43,101],[34,98],[28,88],[25,77]];
paint((x,y) => polygon(x,y,[[25,84],[44,91],[66,97],[83,105],[77,114],[61,119],[43,118],[30,110],[24,99]]), 'beach', 0);
paint((x,y) => polygon(x,y,town), 'grass', 1);
paint((x,y) => ellipse(x,y,59,33,17,14), 'grass', 1);
paint((x,y) => polygon(x,y,[[96,13],[103,6],[114,3],[124,8],[130,18],[130,29],[125,37],[116,43],[103,40],[94,32],[91,23]]), 'grass', 1);
paint((x,y) => polygon(x,y,[[0,13],[30,13],[28,23],[26,34],[22,42],[17,49],[0,59]]), 'grass', 4);
paint((x,y) => ellipse(x,y,24,53,9,9), 'grass', 1);
paint((x,y) => x>=34 && x<40 && y>=56 && y<66, 'grass', 1);
function pathRect(x0,y0,x1,y1) {
  paint((x,y) => x>=x0 && x<x1 && y>=y0 && y<y1 && ground[Math.floor(y)][Math.floor(x)]==='grass', 'pave');
}
function deck(x0,y0,x1,y1,axis) {
  const cellsList=[];
  for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++) cellsList.push([x,y]);
  decks.push({x0,z0:y0,x1,z1:y1,axis,level:1,ramp:false,cellsList,ends:[{at:axis==='x'?x0:y0,level:1},{at:axis==='x'?x1-1:y1-1,level:1}]});
}
deck(51,104,148,111,'x');
deck(145,91,150,124,'z');
deck(141,117,146,120,'x');
deck(149,111,153,114,'x');
deck(56,43,61,69,'z');
deck(72,31,97,36,'x');
deck(111,38,116,67,'z');
deck(28,55,37,59,'x');
pathRect(34,57,39,78);
pathRect(36,76,143,81);
pathRect(56,40,61,79);
pathRect(70,31,101,36);
pathRect(111,35,116,79);
pathRect(91,76,96,105);
pathRect(51,100,143,105);
pathRect(139,74,147,79);
pathRect(22,55,35,59);
paint((x,y) => ellipse(x,y,94,76,12,11) && ground[Math.floor(y)][Math.floor(x)]==='grass','pave');
// Garden loop surrounds four flower beds, a fountain and a small western pond.
paint((x,y) => ellipse(x,y,43,78,13,13) && ground[Math.floor(y)][Math.floor(x)]==='grass','path');
paint((x,y) => ellipse(x,y,43,78,10,10),'grass',1);
pathRect(41,67,46,91);
pathRect(32,76,54,81);
paint((x,y) => ellipse(x,y,36,83,3,3),'sea',0);
for(const [cx,cy] of [[37,72],[49,72],[49,84]]) paint((x,y) => ellipse(x,y,cx,cy,3,3),'flowers',1);
pathRect(41,88,46,99);
function place(id, asset, cx, cy, name, elevation=1, blocking=true) {
  const a=assets[asset], [minX,minY,maxX,maxY]=a.bounds;
  const w=maxX-minX,h=maxY-minY;
  buildings.push({id,asset,name,x:cx,y:cy,level:elevation,blocking,footprint:[cx-w/2,cy-h/2,cx+w/2,cy+h/2],door:[Math.floor(cx),Math.ceil(cy+h/2)]});
}
place('battle-dome','dome',59,31,'Battle Dome');
place('world-tournament','arena',112,21,'Pokémon World Tournament');
place('daycare','daycare',24,52,'Pokémon Daycare');
place('ferris-wheel','wheel',58,96,'Ferris Wheel');
for(const [i,x] of [76,89,102,115,130].entries()) place('shop-'+(i+1),'shop'+(i+1),x,97,'Boardwalk Shop '+(i+1));
place('lighthouse','lighthouse',146,71,'Lighthouse');
place('garden-fountain','fountain',43,78,'Garden Fountain');
place('west-ferry','ship1',135,118,'Journeys Ferry',0);
place('east-ferry','ship2',155,111,'Event Ferry',0);
buildings.push({id:'waterfall',asset:'waterfall',name:'Cliff Waterfall',x:25,y:40,level:0,blocking:true,footprint:[23,34,27,44]});
for(const b of buildings.filter(b=>['battle-dome','world-tournament'].includes(b.id))) pathRect(b.footprint[0]-2,b.footprint[3],b.footprint[2]+2,b.footprint[3]+5);
// Furnish the promenade and beach while keeping the middle of each route open.
for(const x of [67,81,95,109,123,139]) {
  place('promenade-lamp-'+x,'lamp',x,109,'Promenade Lamp');
  place('promenade-bench-'+x,'bench',x+3,109,'Seafront Bench');
}
for(const [x,y] of [[35,103],[43,109],[54,113],[66,111]]) {
  place('beach-parasol-'+x,'parasol',x,y,'Beach Parasol',0);
  place('beach-seat-'+x,'bench',x+2,y+1,'Beach Seat',0);
}
for(const [x,y] of [[82,69],[106,69],[82,84],[106,84],[48,45],[70,44],[100,33],[124,33],[34,69],[53,87]]) place('planter-'+x+'-'+y,'plant',x,y,'Flower Planter');
for(const [x,y] of [[85,64],[104,64],[85,89],[104,89],[39,66],[50,91]]) place('lamp-'+x+'-'+y,'lamp',x,y,'Town Lamp');
// Trees are reserved away from building footprints, bridges and painted paths.
function reserved(x,y) {
  return buildings.some(b=> x>b.footprint[0]-3 && x<b.footprint[2]+3 && y>b.footprint[1]-3 && y<b.footprint[3]+4)
    || decks.some(d=>x>d.x0-3&&x<d.x1+3&&y>d.z0-3&&y<d.z1+3)
    || ellipse(x,y,94,76,14,13);
}
for(let y=5;y<105;y+=3) for(let x=2;x<154;x+=3) {
  if(reserved(x,y) || ground[y][x]!=='grass') continue;
  const clear=[[-1,0],[0,-1],[1,0],[0,1],[2,0],[0,2]].every(([dx,dy])=>ground[y+dy]?.[x+dx]==='grass');
  if(clear && (x<30 || y<44 || x<55 || (x*17+y*13)%11<4)) trees.push({x0:x,z0:y,tile:879});
}
for(let x=52;x<145;x++) fences.push([x,110,'fence',1]);
const beachSteps=[];
for(let y=106;y<110;y++) beachSteps.push([50,y]);
const layout={name:'CoastalHub',width,height,ground,level,decks,trees,fences,stairs:[{dir:'E',cells:beachSteps,lo:0,hi:1}]};
fs.writeFileSync(path.join(out,'terrain.json'),JSON.stringify(layout));
fs.writeFileSync(path.join(out,'landmarks.json'),JSON.stringify(buildings,null,2));
console.log(`${width} x ${height}, ${buildings.length} landmarks, ${trees.length} trees, ${decks.length} decks`);
