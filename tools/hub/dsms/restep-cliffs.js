// Turns stacked cliffs (one 1-high piece on top of another) in a hand-edited Victory Island map into cliff steps:
// each extra level becomes its own 1-high cliff one tile further out, over the water or sand at the foot, so the
// ground on top (trees, railings, paths) stays as it was. Works on the saved .pdsmap and .per files in
// place (backups next to them), so hand edits elsewhere stay. Stair, bridge and unknown tiles keep their corners.
// Usage: node restep-cliffs.js <mapDir> <tile-z.json> [mapName]
const fs = require('fs');
const path = require('path');

const [DIR, ZFILE, NAME = 'VictoryIsland'] = process.argv.slice(2);
const TZ = JSON.parse(fs.readFileSync(ZFILE, 'utf8'));
const mapFile = path.join(DIR, NAME + '.pdsmap');
const raw = fs.readFileSync(mapFile, 'utf8');
const EOL = raw.includes('\r\n') ? '\r\n' : '\n';
const lines = raw.split(/\r?\n/);

// ---- read every map into global grids: tiles[layer][z][x], heights[layer][z][x] (z grows south) ----
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

// ---- tiles this tool understands ----
const CLIFFS = [454, 455, 456, 457, 458, 459, 460, 461, 686, 687, 688, 689]; // HeartGold mountain rock
const isCliff = new Set(CLIFFS);
const highKey = (i) => TZ[i].z[0].slice(0, 4).map((z) => (z > 0.6 ? 1 : 0)).join(''); // corners NW NE SW SE
const cliffByKey = {}; for (const i of CLIFFS) cliffByKey[highKey(i)] ??= i;
const DIAGONAL = { '1001': '1101', '0110': '0111' }; // no diagonal piece: the nearest three-corner one
const GROUND = new Set([1157, 1181, 1170, 1167, 1165, 1166, 1171, 1172, 1173,
  1054, 1055, 1056, 1057, 1058, 1059, 1060, 1061, 1120, 1121, 1128, 1129, 1094, 1095, 1096, 1097, 1098, 1099, 1100, 1101, 1140, 1141, 1148, 1149,
  1062, 1063, 1064, 1065, 1066, 1067, 1068, 1069, 1122, 1123, 1130, 1131, 886, 887, 888, 889, 890, 891, 892, 893, 1134, 1135, 1142, 1143,
  1046, 1047, 1048, 1049, 1050, 1051, 1052, 1053, 1118, 1119, 1126, 1127]);
const STAIRS = new Set([1234, 1235, 1236, 1237, 1238, 1239, 1240, 1241]);
const DECKS = new Set([370, 368, 369, 358, 1245, 1249, 171]);
const FENCE = (id) => id >= 381 && id <= 395;
const TRACK = (id) => id >= 1740 && id <= 1754;
const TREES = new Set([879, 881]);
const GRASS = 1157;

// ---- corner levels from the tiles: flat ground is level h all round, a cliff of n stacked pieces is h..h+n ----
const L = Array.from({ length: H + 1 }, () => Array(W + 1).fill(null));
const locked = new Set();
const corners = (x, z) => [[x, z], [x + 1, z], [x, z + 1], [x + 1, z + 1]];
const lockAround = (x, z, d) => { for (let b = z - d; b <= z + 1 + d; b++) for (let a = x - d; a <= x + 1 + d; a++) locked.add(a + ',' + b); };
for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
  const t = tiles[0][z][x], h = heights[0][z][x];
  let lv = null;
  if (GROUND.has(t)) lv = [h, h, h, h];
  else if (isCliff.has(t)) {
    let n = 1; for (const l of [6, 5, 7]) if (tiles[l][z][x] === t) n++;
    lv = highKey(t).split('').map((c) => (c === '1' ? h + n : h));
  } else lockAround(x, z, 0); // stairs, sea pieces we don't know, hand-placed specials: leave as they are
  if (!lv) continue;
  corners(x, z).forEach(([a, b], k) => { if (L[b][a] !== null && L[b][a] !== lv[k]) locked.add(a + ',' + b); L[b][a] = Math.max(L[b][a] ?? -1, lv[k]); });
}
for (let l = 0; l < 8; l++) for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
  const t = tiles[l][z][x];
  if (STAIRS.has(t)) lockAround(x, z, 1); // stairs and their landings
  if (l === 1 && DECKS.has(t)) lockAround(x, z, 3); // bridges and the boardwalk meet the land where they were built
}
for (let b = 0; b <= H; b++) for (let a = 0; a <= W; a++) if (L[b][a] === null) locked.add(a + ',' + b);

// ---- steps: no corner more than one level below any corner next to it (only ever raised, at the foot) ----
const before = L.map((r) => r.slice());
for (let pass = 0; pass < 20; pass++) {
  let moved = 0;
  for (let b = 0; b <= H; b++) for (let a = 0; a <= W; a++) {
    if (locked.has(a + ',' + b)) continue;
    let target = L[b][a];
    for (let db = -1; db <= 1; db++) for (let da = -1; da <= 1; da++) { const v = L[b + db]?.[a + da]; if (v !== null && v !== undefined) target = Math.max(target, v - 1); }
    if (target > L[b][a]) { L[b][a] = target; moved++; }
  }
  if (!moved) break;
}

// ---- new tiles for every cell whose corners moved or that held a stack ----
const perEdits = []; // [x, z, blocked]
let restepped = 0, kept = 0;
const stacked = (x, z) => [5, 6, 7].some((l) => isCliff.has(tiles[l][z][x]));
for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
  const c = corners(x, z), lv = c.map(([a, b]) => L[b][a]);
  if (lv.some((v) => v === null)) continue;
  const changed = c.some(([a, b]) => L[b][a] !== before[b][a]);
  if (!changed && !stacked(x, z)) continue;
  const old = tiles[0][z][x];
  if (!GROUND.has(old) && !isCliff.has(old)) continue;
  const lo = Math.min(...lv), hi = Math.max(...lv);
  if (new Set(lv).size > 2 || (!changed && hi - lo > 1)) { kept++; continue; } // a locked spot: keep it as it is
  for (const l of [5, 6, 7]) if (isCliff.has(tiles[l][z][x])) { tiles[l][z][x] = -1; heights[l][z][x] = 0; }
  if (hi === lo) {
    const same = GROUND.has(old) && heights[0][z][x] === lo; // untouched flat ground keeps its tile; new ledges are grass
    tiles[0][z][x] = same ? old : GRASS; heights[0][z][x] = lo; perEdits.push([x, z, false]);
  } else {
    const key = lv.map((v) => (v === hi ? 1 : 0)).join('');
    const id = cliffByKey[key] ?? cliffByKey[DIAGONAL[key]];
    tiles[0][z][x] = id; heights[0][z][x] = lo;
    // a drop still taller than one level (beside a locked spot) keeps stacked copies above it
    for (let k = 1; k < hi - lo; k++) { tiles[7 - k][z][x] = id; heights[7 - k][z][x] = lo + k; }
    perEdits.push([x, z, true]);
  }
  restepped++;
}

// ---- things standing on cells that moved: follow the ground, or go when the ground under them is now a cliff ----
const flatLevel = (x, z) => { const lv = corners(x, z).map(([a, b]) => L[b][a]); return lv.every((v) => v === lv[0]) ? lv[0] : null; };
const movedCell = (x, z) => corners(x, z).some(([a, b]) => L[b]?.[a] !== before[b]?.[a]);
let raisedOrLowered = 0; const removed = {};
for (let l = 1; l < 8; l++) for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
  const t = tiles[l][z][x]; if (t < 0 || isCliff.has(t)) continue;
  const foot = TREES.has(t) ? [[x, z], [x + 1, z], [x, z - 1], [x + 1, z - 1]] : [[x, z]];
  if (!foot.some(([a, b]) => movedCell(a, b))) continue;
  const levels = foot.map(([a, b]) => flatLevel(a, b));
  const single = FENCE(t) || TRACK(t) || TREES.has(t);
  if (levels.every((v) => v !== null && v === levels[0])) { if (heights[l][z][x] !== levels[0]) { heights[l][z][x] = levels[0]; raisedOrLowered++; } }
  else if (single) { tiles[l][z][x] = -1; heights[l][z][x] = 0; const kind = FENCE(t) ? 'railings' : TRACK(t) ? 'track' : 'trees'; removed[kind] = (removed[kind] || 0) + 1; }
}

// ---- write the map and collisions back (backups first) ----
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
fs.copyFileSync(mapFile, mapFile + '.before-restep-' + stamp);
for (const m of maps) for (let l = 0; l < 8; l++) for (let r = 0; r < 32; r++) {
  const z = m.my * 32 + 31 - r;
  lines[m.tg[l] + 1 + r] = tiles[l][z].slice(m.mx * 32, m.mx * 32 + 32).join(' ') + ' ';
  lines[m.hg[l] + 1 + r] = heights[l][z].slice(m.mx * 32, m.mx * 32 + 32).join(' ') + ' ';
}
fs.writeFileSync(mapFile, lines.join(EOL));
const pers = {};
for (const [x, z, blocked] of perEdits) {
  const mx = Math.floor(x / 32), my = Math.floor(z / 32), file = path.join(DIR, `${NAME}_${String(mx).padStart(2, '0')}_${String(my).padStart(2, '0')}.per`);
  if (!pers[file]) { pers[file] = fs.readFileSync(file); fs.copyFileSync(file, file + '.before-restep-' + stamp); }
  const k = ((z % 32) * 32 + (x % 32)) * 2;
  pers[file][k] = 0; pers[file][k + 1] = blocked ? 0x80 : 0; // land now: no sea or sand behaviour
}
for (const [file, buf] of Object.entries(pers)) fs.writeFileSync(file, buf);
console.log(`cells restepped ${restepped}, kept as they were ${kept}, things moved to the new ground ${raisedOrLowered}, removed ${JSON.stringify(removed)}`);
