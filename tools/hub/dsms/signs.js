// Puts a HeartGold signpost (board_a) beside the door of each named building in a hand-edited Victory Island map and
// writes the signs into world.json ("signs": x, z, text), where the hub shows the text when the player reads them.
// The building is the large model tile nearest the zone of the same name; the sign goes on the nearest free,
// walkable cell a couple of tiles to the side of the door, never cutting walkable ground off. Signs already there are
// kept (run it again after moving buildings). Backs up the map and .per files.
// Usage: node signs.js <mapDir> <world.json>
const fs = require('fs');
const path = require('path');

const [DIR, WORLD] = process.argv.slice(2);
const NAME = 'VictoryIsland', T = 20;
const BUILDINGS = ['PWT Stadium', 'Battle Dome', 'Trainer Hall', 'Auction House', 'Ferris Wheel', 'Costume Shop', 'Game Shop', 'TM Shop', 'Game Corner', 'Lighthouse'];
const NOT_BUILDINGS = /^(track_|pokeball_plaza|poke_c_(obj|bench|flower|light|mon)|c01arch|c03_slamp|lamp01|c04_plant|board_|sign0|o_|s_parasol|wbt_fountain|c01fountain|c03_fountain|c15_fountain|c04_poke|poke_c_dome$)/;

const mapFile = path.join(DIR, NAME + '.pdsmap');
const raw = fs.readFileSync(mapFile, 'utf8'), EOL = raw.includes('\r\n') ? '\r\n' : '\n', lines = raw.split(/\r?\n/);
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
const pers = {}, perFile = (x, z) => path.join(DIR, `${NAME}_${String(Math.floor(x / 32)).padStart(2, '0')}_${String(Math.floor(z / 32)).padStart(2, '0')}.per`);
const perOf = (x, z) => (pers[perFile(x, z)] ??= fs.readFileSync(perFile(x, z)));
const cellOf = (x, z) => ((z % 32) * 32 + (x % 32)) * 2;

const PLANKS = { 370: [1, 3], 368: [3, 1], 369: [1, 2], 358: [2, 1], 1245: [1, 1], 1249: [1, 1], 171: [1, 3] };
const size = {}, nameOf = {}, id = {};
for (const l of fs.readFileSync(path.join(DIR, 'model-tile-index.txt'), 'utf8').split(/\r?\n/)) {
  const [i, obj, s] = l.split('\t'); if (!s || !/x/.test(s)) continue;
  size[i] = s.split('x').map(Number); nameOf[i] = obj.replace(/\.obj$/, ''); id[nameOf[i]] = +i;
}
const BOARD = id.board_a;
if (BOARD === undefined) throw new Error('board_a is not in the tileset: run dsms.sh props first');

// what stands where: building footprints and every occupied cell
const occupied = new Set(), buildings = [], boards = [];
for (let l = 1; l < 8; l++) for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
  const t = tiles[l][z][x]; if (t < 0) continue;
  if (t === BOARD) boards.push([x, z]);
  const [w, h] = size[t] || [1, 1];
  if (!(t >= 1740 && t <= 1754) && t !== id.pokeball_plaza && !PLANKS[t]) for (let dz = 0; dz < h; dz++) for (let dx = 0; dx < w; dx++) occupied.add((x + dx) + ',' + (z - dz));
  if (nameOf[t] && !NOT_BUILDINGS.test(nameOf[t]) && w >= 2 && h >= 2) buildings.push({ x, z, w, h, name: nameOf[t] });
}
// planks [width, height] from the south-west cell: a sign on the boardwalk stands at plank height
function deckHeight(x, z) {
  for (let l = 1; l < 8; l++) for (let b = z; b <= z + 2; b++) for (let a = x - 2; a <= x; a++) {
    const p = PLANKS[tiles[l][b]?.[a]]; if (p && x < a + p[0] && z > b - p[1]) return heights[l][b][a];
  }
  return null;
}
const CLIFFS = new Set([454, 455, 456, 457, 458, 459, 460, 461, 686, 687, 688, 689]);
const walkable = (x, z) => x >= 0 && z >= 0 && x < W && z < H && perOf(x, z)[cellOf(x, z) + 1] === 0;
const onDeck = (x, z) => perOf(x, z)[cellOf(x, z)] === 0x73;
const free = (x, z) => walkable(x, z) && !occupied.has(x + ',' + z) && !CLIFFS.has(tiles[0][z][x]) && (!onDeck(x, z) || deckHeight(x, z) !== null);
const standHeight = (x, z) => (onDeck(x, z) ? deckHeight(x, z) : heights[0][z][x]);
const world = JSON.parse(fs.readFileSync(WORLD, 'utf8'));
const spawn = [Math.floor(world.spawn.x / T), Math.floor(world.spawn.z / T)];
const reach = () => { const seen = new Set(), q = [spawn];
  for (let i = 0; i < q.length; i++) { const [x, z] = q[i], k = x + ',' + z; if (seen.has(k) || !walkable(x, z)) continue; seen.add(k);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) q.push([x + dx, z + dz]); }
  return seen.size; };
let reachable = reach();
const npcCells = new Set((world.npcs || []).map((n) => Math.floor(n.x / T) + ',' + Math.floor(n.z / T)));

const signs = (world.signs || []).filter((s) => !BUILDINGS.includes(s.text));
let added = 0;
for (const zoneName of BUILDINGS) {
  const zone = world.zones.find((z) => z.name === zoneName); if (!zone) continue;
  const zx = zone.x / T, zz = zone.z / T;
  const b = buildings.map((b) => ({ ...b, d: Math.hypot(b.x + b.w / 2 - zx, b.z - b.h / 2 + 0.5 - zz) })).sort((p, q) => p.d - q.d)[0];
  if (!b || b.d > 12) { console.log(`${zoneName}: no building found`); continue; }
  const door = [b.x + Math.floor(b.w / 2), b.z + 1];
  let spot = boards.find(([x, z]) => Math.hypot(x - door[0], z - door[1]) <= 4);
  if (!spot) {
    for (const [dx, dz] of [[-2, 0], [2, 0], [-2, 1], [2, 1], [-3, 0], [3, 0], [-3, 1], [3, 1], [-1, 1], [1, 1], [-2, 2], [2, 2]]) {
      const x = door[0] + dx, z = door[1] + dz;
      if (!free(x, z) || npcCells.has(x + ',' + z) || (walkable(door[0], door[1]) && standHeight(x, z) !== standHeight(door[0], door[1]))) continue;
      const o = cellOf(x, z), buf = perOf(x, z), saved = buf[o + 1];
      buf[o + 1] = 0x80;
      const now = reach(); if (now + 1 < reachable) { buf[o + 1] = saved; continue; }
      reachable = now;
      let l = 1; while (l < 8 && tiles[l][z][x] >= 0) l++;
      if (l === 8) { buf[o + 1] = saved; continue; }
      tiles[l][z][x] = BOARD; heights[l][z][x] = standHeight(x, z); occupied.add(x + ',' + z);
      spot = [x, z]; added++; break;
    }
  }
  if (!spot) { console.log(`${zoneName}: no room for a sign by the door at ${door}`); continue; }
  signs.push({ x: (spot[0] + 0.5) * T, z: (spot[1] + 0.5) * T, text: zoneName });
  console.log(`${zoneName}: sign at ${spot} (${b.name}, door ${door})`);
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
if (added) {
  fs.copyFileSync(mapFile, mapFile + '.before-signs-' + stamp);
  for (const m of maps) for (let l = 0; l < 8; l++) for (let r = 0; r < 32; r++) {
    const z = m.my * 32 + 31 - r;
    lines[m.tg[l] + 1 + r] = tiles[l][z].slice(m.mx * 32, m.mx * 32 + 32).join(' ') + ' ';
    lines[m.hg[l] + 1 + r] = heights[l][z].slice(m.mx * 32, m.mx * 32 + 32).join(' ') + ' ';
  }
  fs.writeFileSync(mapFile, lines.join(EOL));
  for (const [file, buf] of Object.entries(pers)) { fs.copyFileSync(file, file + '.before-signs-' + stamp); fs.writeFileSync(file, buf); }
}
world.signs = signs;
fs.writeFileSync(WORLD, JSON.stringify(world, null, 2) + '\n');
console.log(`signs placed ${added}, signs in world.json ${signs.length}`);
