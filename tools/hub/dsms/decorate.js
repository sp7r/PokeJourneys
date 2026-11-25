// Dresses a hand-edited Victory Island map: lays the round Poke Ball plaza tile in front of the stadium and fills
// empty lawns with props (tree groves, flower planters, lamps, benches, a fountain and a statue; Pokeathlon pieces on
// the stadium island). Only bare, flat, walkable grass is used; paths stay clear, the hub review route, NPC spots,
// doorsteps and the daycare pen are left free, and every prop is checked not to cut any walkable ground off.
// Works in place on the .pdsmap and .per files (backups first); run dsms.sh export afterwards.
// Usage: node decorate.js <mapDir> <tile-z.json> <world.json> [plazaX,plazaZ]
const fs = require('fs');
const path = require('path');

const [DIR, ZFILE, WORLD, PLAZA = '70.5,30.5'] = process.argv.slice(2);
const NAME = 'VictoryIsland', T = 20; // hub units per tile
const mapFile = path.join(DIR, NAME + '.pdsmap');
const raw = fs.readFileSync(mapFile, 'utf8'), EOL = raw.includes('\r\n') ? '\r\n' : '\n', lines = raw.split(/\r?\n/);

// ---- map grids ----
const maps = []; let MW = 0, MH = 0;
for (let i = 0; i < lines.length; i++) if (lines[i] === 'mapstart') {
  const [mx, my] = lines[i + 1].trim().split(' ').map(Number), m = { mx, my, tg: [], hg: [] };
  for (let k = i + 2; lines[k] !== 'mapend'; k++) { if (lines[k] === 'tilegrid') m.tg.push(k); if (lines[k] === 'heightgrid') m.hg.push(k); }
  maps.push(m); MW = Math.max(MW, mx + 1); MH = Math.max(MH, my + 1);
}
const W = MW * 32, H = MH * 32;
const grid = (v) => Array.from({ length: 8 }, () => Array.from({ length: H }, () => Array(W).fill(v)));
const tiles = grid(-1), heights = grid(0);
for (const m of maps) for (let l = 0; l < 8; l++) for (let r = 0; r < 32; r++) {
  const t = lines[m.tg[l] + 1 + r].trim().split(/\s+/).map(Number), h = lines[m.hg[l] + 1 + r].trim().split(/\s+/).map(Number);
  for (let c = 0; c < 32; c++) { tiles[l][m.my * 32 + 31 - r][m.mx * 32 + c] = t[c]; heights[l][m.my * 32 + 31 - r][m.mx * 32 + c] = h[c]; }
}
const perFile = (x, z) => path.join(DIR, `${NAME}_${String(Math.floor(x / 32)).padStart(2, '0')}_${String(Math.floor(z / 32)).padStart(2, '0')}.per`);
const pers = {}; const perOf = (x, z) => (pers[perFile(x, z)] ??= fs.readFileSync(perFile(x, z)));
const perAt = (x, z) => { const b = perOf(x, z), o = ((z % 32) * 32 + (x % 32)) * 2; return [b[o], b[o + 1]]; };
const block = (x, z) => { const b = perOf(x, z), o = ((z % 32) * 32 + (x % 32)) * 2; b[o + 1] = 0x80; };

// ---- tile sizes: base tiles from tile-z.json, converted models from model-tile-index.txt ----
const size = {}, id = {};
for (const [i, e] of Object.entries(JSON.parse(fs.readFileSync(ZFILE, 'utf8')))) size[i] = [e.w, e.h];
for (const l of fs.readFileSync(path.join(DIR, 'model-tile-index.txt'), 'utf8').split(/\r?\n/)) {
  const [i, obj, s] = l.split('\t'); if (!s || !/x/.test(s)) continue;
  size[i] = s.split('x').map(Number); id[obj.replace(/\.obj$/, '')] = +i;
}
const TRACK = (t) => t >= 1740 && t <= 1754;
const GRASS = new Set([1157, 1171, 1172, 1173]);
const PATHS = (t) => !GRASS.has(t) && t !== 1170 && t !== 1181; // paving, path, brick and their edges (not sea or sand)

// ---- what is already there ----
const occupied = Array.from({ length: H }, () => Array(W).fill(false));
const buildings = []; // footprints of model tiles, for doorsteps
for (let l = 1; l < 8; l++) for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
  const t = tiles[l][z][x]; if (t < 0 || TRACK(t)) continue;
  const [w, h] = size[t] || [1, 1];
  for (let dz = 0; dz < h; dz++) for (let dx = 0; dx < w; dx++) if (occupied[z - dz]) occupied[z - dz][x + dx] = true;
  if (t >= 1638 && w >= 3 && h >= 2) buildings.push({ x, z, w, h });
}
const hasTrack = (x, z) => [1, 2, 3, 4, 5, 6, 7].some((l) => TRACK(tiles[l][z][x]));
const flat = (x, z) => [454, 455, 456, 457, 458, 459, 460, 461, 686, 687, 688, 689].indexOf(tiles[0][z][x]) < 0;
const reserved = new Set();
const reserve = (x, z, r) => { for (let b = z - r; b <= z + r; b++) for (let a = x - r; a <= x + r; a++) reserved.add(a + ',' + b); };
// the review route the hub walks, NPCs and the spawn
const world = JSON.parse(fs.readFileSync(WORLD, 'utf8'));
const route = (world.review?.points || world.review || []);
for (let i = 0; i + 1 < route.length; i++) {
  const a = route[i], b = route[i + 1], n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 5);
  for (let k = 0; k <= n; k++) reserve(Math.floor((a.x + (b.x - a.x) * k / n) / T), Math.floor((a.z + (b.z - a.z) * k / n) / T), 1);
}
for (const n of world.npcs || []) reserve(Math.floor(n.x / T), Math.floor(n.z / T), 2);
if (world.spawn) reserve(Math.floor(world.spawn.x / T), Math.floor(world.spawn.z / T), 2);
for (const b of buildings) for (let dz = 1; dz <= 2; dz++) for (let dx = -1; dx <= b.w; dx++) reserved.add((b.x + dx) + ',' + (b.z + dz)); // doorsteps
for (let z = 38; z <= 60; z++) for (let x = 0; x <= 22; x++) reserved.add(x + ',' + z); // the daycare pen

const buildingCell = new Set(); for (const b of buildings) for (let dz = 0; dz < b.h; dz++) for (let dx = 0; dx < b.w; dx++) buildingCell.add((b.x + dx) + ',' + (b.z - dz));
const free = (x, z) => x >= 0 && z >= 0 && x < W && z < H && GRASS.has(tiles[0][z][x]) && flat(x, z) && !occupied[z][x]
  && !hasTrack(x, z) && !reserved.has(x + ',' + z) && perAt(x, z)[1] === 0 && perAt(x, z)[0] !== 0x73;

// distance (4-neighbour steps) from any path, paving, track or deck
const pathDist = Array.from({ length: H }, () => Array(W).fill(99));
{ const q = [];
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) if ((PATHS(tiles[0][z][x]) && flat(x, z) && perAt(x, z)[1] === 0) || hasTrack(x, z) || perAt(x, z)[0] === 0x73) { pathDist[z][x] = 0; q.push([x, z]); }
  for (let i = 0; i < q.length; i++) { const [x, z] = q[i]; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = x + dx, b = z + dz;
    if (a >= 0 && b >= 0 && a < W && b < H && pathDist[b][a] > pathDist[z][x] + 1) { pathDist[b][a] = pathDist[z][x] + 1; q.push([a, b]); } } } }

// walkable ground reachable from the spawn; a prop may only take its own cells away
const walkable = (x, z) => x >= 0 && z >= 0 && x < W && z < H && perAt(x, z)[1] === 0;
const spawn = world.spawn ? [Math.floor(world.spawn.x / T), Math.floor(world.spawn.z / T)] : [55, 70];
const reach = () => { const seen = new Set(), q = [spawn];
  for (let i = 0; i < q.length; i++) { const [x, z] = q[i], k = x + ',' + z; if (seen.has(k) || !walkable(x, z)) continue; seen.add(k);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) q.push([x + dx, z + dz]); }
  return seen.size; };
let reachable = reach();

// ---- placing ----
const placed = []; // { name, x, z (centre) }
function put(name, x0, zS, cells, blocks, t = id[name]) {
  if (t === undefined) return false;
  if (!cells.every(([a, b]) => free(a, b) && heights[0][b][a] === heights[0][zS][x0])) return false;
  const saved = blocks.map(([a, b]) => perAt(a, b)[1]);
  blocks.forEach(([a, b]) => block(a, b));
  const now = reach();
  if (now + blocks.length < reachable) { blocks.forEach(([a, b], k) => { const o = ((b % 32) * 32 + (a % 32)) * 2; perOf(a, b)[o + 1] = saved[k]; }); return false; }
  reachable = now;
  let l = 1; while (l < 8 && tiles[l][zS][x0] >= 0) l++;
  if (l === 8) return false;
  tiles[l][zS][x0] = t; heights[l][zS][x0] = heights[0][zS][x0];
  cells.forEach(([a, b]) => (occupied[b][a] = true));
  placed.push({ name, x: cells.reduce((s, c) => s + c[0], 0) / cells.length, z: cells.reduce((s, c) => s + c[1], 0) / cells.length });
  return true;
}
const rect = (x0, zS, w, h) => { const c = []; for (let dz = 0; dz < h; dz++) for (let dx = 0; dx < w; dx++) c.push([x0 + dx, zS - dz]); return c; };
const near = (x, z, names, d) => placed.some((p) => names.includes(p.name) && Math.hypot(p.x - x, p.z - z) < d);
const stadium = (x, z) => heights[0][z][x] === 3; // the stadium island level

// 1. the Poke Ball plaza: one tile, the disc centred on the plaza (no collision, it is floor)
{ const [cx, cz] = PLAZA.split(',').map(Number), x0 = Math.round(cx - 2.5), zS = Math.round(cz + 2.5), t = id.pokeball_plaza;
  if (t !== undefined && ![1, 2, 3, 4, 5, 6, 7].some((l) => tiles[l][zS][x0] === t)) {
    let l = 4; while (l < 8 && tiles[l][zS][x0] >= 0) l++;
    if (l < 8) { tiles[l][zS][x0] = t; heights[l][zS][x0] = heights[0][Math.floor(cz)][Math.floor(cx)]; console.log(`plaza on cell ${x0},${zS} layer ${l + 1}`); }
  }
  // track just outside the disc goes, except the paths leading in (west, south, and north to the stadium door)
  const R = 6.5; let trimmed = 0;
  for (let z = Math.floor(cz - R - 2); z <= cz + R + 2; z++) for (let x = Math.floor(cx - R - 2); x <= cx + R + 2; x++) {
    const dx = x + 0.5 - cx, dz = z + 0.5 - cz, dist = Math.hypot(dx, dz);
    if (dist <= R - 0.5 || dist > R + 2) continue;
    if ((Math.abs(dz) <= 2.5 && dx < 0) || (Math.abs(dx) <= 2.5 && dz > 0) || (Math.abs(dx) <= 2 && dz < 0)) continue;
    for (let l = 1; l < 8; l++) if (TRACK(tiles[l][z][x])) { tiles[l][z][x] = -1; heights[l][z][x] = 0; trimmed++; }
  }
  console.log('track trimmed around the plaza', trimmed); }

// candidates sorted by a score, best first
const cellsOfMap = []; for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) if (free(x, z)) cellsOfMap.push([x, z]);
const lawnScore = (x, z) => pathDist[z][x];

// 2. lamps along the paths, about every eight tiles (Pokeathlon lights on the stadium island)
const LAMPS = ['c03_slamp_02', 'lamp01', 'poke_c_light'];
for (const [x, z] of [...cellsOfMap].sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]))) {
  if (pathDist[z][x] !== 1 || placed.filter((p) => LAMPS.includes(p.name)).length >= 26) continue;
  if (near(x, z, LAMPS, 8) || near(x, z, ['c04_plant_01', 'poke_c_bench'], 3)) continue;
  if (stadium(x, z)) put('poke_c_light', x - 1, z + 1, [[x, z]], [[x, z]]);
  else put('c03_slamp_02', x, z, [[x, z], [x + 1, z]], [[x, z]]);
}
// 3. flower planters beside the paths, every twelve tiles or so
for (const [x, z] of [...cellsOfMap].sort((a, b) => (a[0] * 7 + a[1] * 13) % 31 - (b[0] * 7 + b[1] * 13) % 31)) {
  if (placed.filter((p) => p.name === 'c04_plant_01').length >= 14) break;
  const c = rect(x, z, 2, 2);
  if (!c.some(([a, b]) => pathDist[b]?.[a] === 1) || near(x + 0.5, z - 0.5, ['c04_plant_01'], 12) || near(x + 0.5, z - 0.5, LAMPS, 3)) continue;
  put('c04_plant_01', x, z, c, c);
}
// 4. benches facing the paths
for (const [x, z] of [...cellsOfMap].sort((a, b) => (a[0] * 11 + a[1] * 5) % 29 - (b[0] * 11 + b[1] * 5) % 29)) {
  if (placed.filter((p) => p.name === 'poke_c_bench').length >= 10) break;
  const c = rect(x, z, 2, 1);
  if (!c.every(([a, b]) => pathDist[b]?.[a] === 1) || near(x + 0.5, z, ['poke_c_bench'], 10) || near(x + 0.5, z, [...LAMPS, 'c04_plant_01'], 2.5)) continue;
  put('poke_c_bench', x, z, c, c);
}
// 5. Pokeathlon flower beds on the stadium island lawns (11 x 3 drawn, centred on a 6 x 3 tile)
for (const [x, z] of [...cellsOfMap].filter(([x, z]) => stadium(x, z)).sort((a, b) => lawnScore(b[0], b[1]) - lawnScore(a[0], a[1]))) {
  if (placed.filter((p) => p.name === 'poke_c_flower').length >= 3) break;
  const c = rect(x - 2, z, 11, 3);
  if (near(x + 3, z - 1, ['poke_c_flower'], 8)) continue;
  put('poke_c_flower', x, z, c, c);
}
// 6. a fountain and the Pikachu statue in the two most open lawns of the town
for (const name of ['c01fountain_01', 'c04_poke01']) {
  const [w, h] = size[id[name]] || [2, 2];
  for (const [x, z] of [...cellsOfMap].filter(([x, z]) => !stadium(x, z)).sort((a, b) => lawnScore(b[0], b[1]) - lawnScore(a[0], a[1]))) {
    if (near(x, z, ['c01fountain_01', 'c04_poke01'], 14)) continue;
    const c = rect(x, z, w, h); if (put(name, x, z, c, c)) break;
  }
}
// 7. tree groves in the middle of the open lawns, a tile or more off the paths and buildings
for (const [x, z] of [...cellsOfMap].sort((a, b) => lawnScore(b[0], b[1]) - lawnScore(a[0], a[1]) || (a[0] + a[1]) - (b[0] + b[1]))) {
  if (placed.filter((p) => p.name === 'tree').length >= 56) break;
  const c = rect(x, z, 2, 2);
  const besideBuilding = c.some(([a, b]) => buildingCell.has((a - 1) + ',' + b) || buildingCell.has((a + 1) + ',' + b) || buildingCell.has(a + ',' + (b - 1)) || buildingCell.has(a + ',' + (b + 1)));
  if (besideBuilding || !c.every(([a, b]) => pathDist[b]?.[a] >= 2) || near(x + 0.5, z - 0.5, ['c01fountain_01', 'c04_poke01', 'poke_c_flower'], 4)) continue;
  put('tree', x, z, c, c, (x + z) % 4 < 2 ? 879 : 881); // the two Platinum 2x2 trees, mixed
}

// 8. small flower patches painted into the lawns that are still bare (flowers are ground, so no collision)
const FLOWERS = [1171, 1172, 1173]; let patches = 0;
for (const [x, z] of [...cellsOfMap].sort((a, b) => lawnScore(b[0], b[1]) - lawnScore(a[0], a[1]) || ((a[0] * 5 + a[1] * 3) % 17) - ((b[0] * 5 + b[1] * 3) % 17))) {
  if (patches >= 30) break;
  const c = rect(x, z, 3, 2);
  if (!c.every(([a, b]) => free(a, b) && pathDist[b][a] >= 2 && tiles[0][b][a] === 1157) || near(x + 1, z - 0.5, ['flowers'], 5) || near(x + 1, z - 0.5, ['tree'], 2.5)) continue;
  c.forEach(([a, b], k) => { tiles[0][b][a] = FLOWERS[(a + b + k) % 3]; occupied[b][a] = true; });
  placed.push({ name: 'flowers', x: x + 1, z: z - 0.5 }); patches++;
}

// ---- write back ----
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
fs.copyFileSync(mapFile, mapFile + '.before-decorate-' + stamp);
for (const m of maps) for (let l = 0; l < 8; l++) for (let r = 0; r < 32; r++) {
  const z = m.my * 32 + 31 - r;
  lines[m.tg[l] + 1 + r] = tiles[l][z].slice(m.mx * 32, m.mx * 32 + 32).join(' ') + ' ';
  lines[m.hg[l] + 1 + r] = heights[l][z].slice(m.mx * 32, m.mx * 32 + 32).join(' ') + ' ';
}
fs.writeFileSync(mapFile, lines.join(EOL));
for (const [file, buf] of Object.entries(pers)) { fs.copyFileSync(file, file + '.before-decorate-' + stamp); fs.writeFileSync(file, buf); }
const count = {}; for (const p of placed) count[p.name] = (count[p.name] || 0) + 1;
console.log('placed', JSON.stringify(count));
