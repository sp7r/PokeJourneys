// Victory Island at the ROM models' native size: the same three islands as the first design (town island with the
// boardwalk and beach in the south, Battle Dome island north-west, stadium island north-east), made large enough that
// every building stands at 1:1 (16 DS units per tile) on its own lot with a straight path to its door.
// Coastlines are the island shapes bent by smooth seeded noise, then cleaned of thin spurs; tree lines follow the
// coasts and fill the open lawns. Writes the layout format of minecraft-layout.js / victory-design.js for
// victory-map.js (trees as 2x2 Platinum tree tiles), and the Godot hub's layout (buildings on their lots, doors,
// signs, props, shipmasters, zones).
// Tiles: x east, z south, 128 x 128 (4 x 4 maps). Levels: 0 sea and beach, 1 town, 2 Battle Dome island, 3 stadium island.
// Usage: node victory-design-1to1.js <out-layout.json> <out-godot-layout.json> [seed] [--trees]
const fs = require('fs');

const W = 128, H = 128, SEED = +(process.argv.slice(4).find((a) => /^d+$/.test(a)) || 7);
const TREES = process.argv.includes('--trees'); // tree lines and groves; off by default so the map stays a base to dress by hand
const ground = Array.from({ length: H }, () => Array(W).fill('sea'));
const level = Array.from({ length: H }, () => Array(W).fill(0));
const at = (x, z) => x >= 0 && z >= 0 && x < W && z < H;
const ellipse = (cx, cz, rx, rz) => (x, z) => ((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2 <= 1;
const circle = (cx, cz, r) => ellipse(cx, cz, r, r);
const rect = (x0, z0, x1, z1) => (x, z) => x >= x0 && x < x1 && z >= z0 && z < z1;
const or = (...f) => (x, z) => f.some((g) => g(x, z));
const and = (...f) => (x, z) => f.every((g) => g(x, z));
const not = (f) => (x, z) => !f(x, z);
// straight paths only: a run along x or z, `width` painted tiles (3 painted draw as about 2 once edge tiles count)
const hpath = (z, x0, x1, width = 3) => rect(Math.min(x0, x1), z - (width - 1) / 2 - 0.5, Math.max(x0, x1) + 1, z + (width - 1) / 2 + 0.5);
const vpath = (x, z0, z1, width = 3) => rect(x - (width - 1) / 2 - 0.5, Math.min(z0, z1), x + (width - 1) / 2 + 0.5, Math.max(z0, z1) + 1);
const roundRect = (x0, z0, x1, z1, r) => (x, z) => {
  if (x < x0 || x >= x1 || z < z0 || z >= z1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r), cz = Math.min(Math.max(z, z0 + r), z1 - r);
  return Math.hypot(x - cx, z - cz) <= r;
};

// ---------------- smooth seeded noise ----------------
let rs = SEED >>> 0;
const rand = () => ((rs = (rs * 1664525 + 1013904223) >>> 0) / 4294967296);
const lattice = (period) => { const n = Math.ceil(W / period) + 3, g = Array.from({ length: n }, () => Array.from({ length: n }, rand)); return { period, g }; };
const smooth = (t) => t * t * (3 - 2 * t);
const sample = ({ period, g }, x, z) => {
  const fx = x / period + 1, fz = z / period + 1, ix = Math.floor(fx), iz = Math.floor(fz), tx = smooth(fx - ix), tz = smooth(fz - iz);
  const a = g[iz][ix] + (g[iz][ix + 1] - g[iz][ix]) * tx, b = g[iz + 1][ix] + (g[iz + 1][ix + 1] - g[iz + 1][ix]) * tx;
  return a + (b - a) * tz; // 0..1
};
const WARP = [[lattice(20), lattice(20), 7], [lattice(8), lattice(8), 2]]; // [x noise, z noise, amplitude in tiles]
const warp = (f) => (x, z) => {
  let dx = 0, dz = 0;
  for (const [nx, nz, a] of WARP) { dx += (sample(nx, x, z) - 0.5) * 2 * a; dz += (sample(nz, x, z) - 0.5) * 2 * a; }
  return f(x + dx, z + dz);
};
const GROVE = lattice(11), SPARSE = lattice(5);

// Native model bounds in tiles, DS Map Studio axes (x east, y north) around the model origin: [minX, minY, maxX, maxY]
// (measured with glb-to-obj.js convert(glb, dir, name, 1, 16)).
const BOUNDS = {
  c04tcourt_01: [-7.8, -7.6, 7.8, 6.2], poke_c_dome2: [-8.4, -7.1, 8.2, 7.2], c2_museum_01: [-5.0, -3.5, 5.0, 3.8],
  c5_build_01: [-5.0, -2.8, 5.2, 2.8], c5_market_01: [-4.3, -4.4, 4.3, 4.4], c5_lhouse_01: [-1.9, -4.5, 1.9, 4.5],
  pc_01: [-3.6, -2.4, 3.7, 2.9], c5_house_02: [-3.2, -2.1, 3.2, 2.5], c12_house_01: [-2.2, -2.1, 3.5, 3.0],
  c04theater_01: [-8.6, -9.5, 8.6, 7.1], c04_fwheel_01: [-7.7, -3.8, 7.7, 3.5], t2_build01: [-2.9, -2.6, 3.4, 3.4],
  c03_ship_02: [-8.1, -3.6, 6.6, 3.6], c13_ship_01: [-3.6, -8.0, 3.6, 7.0],
};

// ---------------- building lots (native footprints), doors facing south ----------------
const lots = [], buildings = [];
// a lot sized to the model's native footprint, its south edge (front) on z1 and centred on cx
const lot = (role, model, cx, z1, name, opts = {}) => {
  const [minX, minY, maxX, maxY] = BOUNDS[model];
  const w = Math.ceil(maxX - minX - 0.05), d = Math.ceil(maxY - minY - 0.05);
  const x0 = Math.round(cx - w / 2), z0 = z1 - d;
  const l = { role, name, x0, z0, x1: x0 + w, z1, cx: x0 + w / 2, cz: z0 + d / 2, cells: w * d, base: 0, top: 0, door: [Math.floor(x0 + w / 2), z1 - 1], level: opts.level ?? 1 };
  lots.push(l);
  const ox = x0 + w / 2 - (minX + maxX) / 2, oz = z1 + minY; // model's south extent (-minY) sits on the lot's south edge
  buildings.push({ id: role, model, kind: 'building', x: +ox.toFixed(2), z: +oz.toFixed(2), level: opts.level ?? 1, rot: 0, name, door: l.door });
  return l;
};
// town: shop row on the promenade (fronts on z = 105), west to east, with the avenue from the plaza between them
const FRONT = 105, STREET = 84, AVENUE = 83, PLAZA = [83, 84], GARDEN = [31, 84];
const ferris = lot('ferris', 'c04_fwheel_01', 41, FRONT, 'Ferris Wheel');
const theater = lot('costume', 'c04theater_01', 60, FRONT, 'Costume Shop');
const games = lot('games', 'pc_01', 75, FRONT, 'Game Item Shop');
const tutor = lot('tutor', 'c5_house_02', 90.5, FRONT, 'TM Shop');
const mart = lot('mart', 'c12_house_01', 99, FRONT, 'Poke Mart');
const corner = lot('corner', 'c5_build_01', 109.5, FRONT, 'Game Corner');
// north of the main street
const apartments = lot('apartments', 't2_build01', 72.5, 74, 'Apartments');
const auction = lot('auction', 'c5_market_01', 107.5, 80, 'Auction House');
const lighthouse = lot('lighthouse', 'c5_lhouse_01', 118, 80, 'Lighthouse');
// upper islands
const dome = lot('battle_dome', 'c04tcourt_01', 30, 38, 'Battle Dome', { level: 2 });
const stadium = lot('stadium', 'poke_c_dome2', 90, 26, 'PWT Stadium', { level: 3 });
const hall = lot('hall', 'c2_museum_01', 78, 46, 'Trainer Hall', { level: 3 });
const lotsOn = (zMin, zMax) => lots.filter((l) => l.z1 > zMin && l.z0 < zMax);
const lotCover = (pad, list = lots) => (x, z) => list.some((l) => x >= l.x0 - pad && x < l.x1 + pad && z >= l.z0 - pad && z < l.z1 + pad);

// ---------------- islands ----------------
// each island: a rough shape bent by noise, plus the ground it must keep (lots with a margin, bridge landings)
// (landing pads end where each bridge's deck starts, so no land is left beside the deck over the water)
const landings = { townWest: rect(26, 65, 37, 71), townEast: rect(91, 65, 101, 71), domeSouth: rect(27, 44, 36, 52), domeEast: rect(42, 31, 50, 37),
  stadiumWest: rect(66, 31, 72, 37), stadiumSouth: rect(92, 47, 100, 57) };
// town: three lobes (garden west, plaza middle, lighthouse point east), a straight built-up south shore for the boardwalk,
// and a bay in the north shore between the two bridges
const townShape = and(or(warp(or(ellipse(66, 86, 54, 20), ellipse(30, 85, 21, 18), ellipse(112, 81, 13, 12))), rect(20, 98, 118, 109),
  lotCover(3, lotsOn(60, 110)), landings.townWest, landings.townEast), not(warp(ellipse(60, 61, 13, 6))));
const town = and(townShape, (x, z) => z >= 60 && z < 109);
const domeShape = and(or(warp(ellipse(30, 33, 19, 17)), lotCover(3, [dome]), landings.domeSouth, landings.domeEast), (x, z) => z < 52);
const stadiumShape = and(or(warp(or(ellipse(90, 28, 24, 23), ellipse(96, 48, 9, 8))), lotCover(3, [stadium, hall]), landings.stadiumWest, landings.stadiumSouth), (x, z) => z < 57);
// clean a mask: drop spurs and one-tile inlets so every coast piece has a tile set (marching squares need 2-wide land)
const mask = (f) => Array.from({ length: H }, (_, z) => Array.from({ length: W }, (_, x) => f(x + 0.5, z + 0.5)));
const clean = (m, keep) => {
  for (let pass = 0; pass < 6; pass++) {
    let changed = 0;
    for (let z = 1; z < H - 1; z++) for (let x = 1; x < W - 1; x++) {
      const n4 = m[z - 1][x] + m[z + 1][x] + m[z][x - 1] + m[z][x + 1];
      const n8 = n4 + m[z - 1][x - 1] + m[z - 1][x + 1] + m[z + 1][x - 1] + m[z + 1][x + 1];
      const thin = (m[z][x - 1] === 0 && m[z][x + 1] === 0) || (m[z - 1][x] === 0 && m[z + 1][x] === 0);
      if (m[z][x] && !keep(x + 0.5, z + 0.5) && (n8 <= 3 || thin)) { m[z][x] = 0; changed++; }
      else if (!m[z][x] && (n4 >= 3 || n8 >= 6)) { m[z][x] = 1; changed++; }
    }
    if (!changed) break;
  }
  return m;
};
const toNum = (m) => m.map((r) => r.map((v) => (v ? 1 : 0)));
const townM = clean(toNum(mask(town)), or(landings.townWest, landings.townEast, rect(20, 100, 118, 109)));
const domeM = clean(toNum(mask(domeShape)), or(landings.domeSouth, landings.domeEast));
const stadiumM = clean(toNum(mask(stadiumShape)), or(landings.stadiumWest, landings.stadiumSouth));
for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
  if (stadiumM[z][x]) { ground[z][x] = 'grass'; level[z][x] = 3; }
  else if (domeM[z][x]) { ground[z][x] = 'grass'; level[z][x] = 2; }
  else if (townM[z][x]) { ground[z][x] = 'grass'; level[z][x] = 1; }
}
// beach: a cove south-west of the town, one level down, under the west end of the boardwalk
const beachM = clean(toNum(mask(and(warp(or(ellipse(14, 104, 15, 12), ellipse(8, 92, 7, 10))), (x, z) => !townM[Math.floor(z)]?.[Math.floor(x)]))), () => false);
for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) if (beachM[z][x] && ground[z][x] === 'sea') ground[z][x] = 'beach';
const cell = (x, z) => [Math.floor(x), Math.floor(z)];
const onLevel = (l) => (x, z) => { const [cx, cz] = cell(x, z); return at(cx, cz) && level[cz][cx] === l && ground[cz][cx] !== 'sea'; };
const paint = (test, g) => { for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) if (test(x + 0.5, z + 0.5)) ground[z][x] = g; };
const pave = (f, l) => paint(and(f, onLevel(l), (x, z) => ground[Math.floor(z)][Math.floor(x)] === 'grass'), 'pave');

// ---------------- streets, plazas and doorsteps ----------------
// town: main street west-east, promenade along the shop fronts, avenue from the plaza to the promenade
pave(hpath(STREET, GARDEN[0] + 8, lighthouse.door[0]), 1);
pave(rect(22, FRONT, 117, 109), 1);
pave(vpath(AVENUE, PLAZA[1], FRONT), 1);
pave(circle(PLAZA[0], PLAZA[1], 8.5), 1);
paint(and(circle(PLAZA[0], PLAZA[1], 6), (x, z) => z < PLAZA[1], onLevel(1)), 'brick'); // Poke Ball plaza: red upper half
paint(and(circle(PLAZA[0], PLAZA[1], 2.5), onLevel(1)), 'brick');
pave(vpath(96, 69, STREET), 1);                              // up to the stadium bridge stairs
pave(vpath(GARDEN[0], 69, GARDEN[1]), 1);                     // garden up to the Battle Dome bridge stairs
for (const l of [apartments, auction, lighthouse]) pave(vpath(l.door[0], l.z1 - 1, STREET), 1);
for (const l of [ferris, theater, games, tutor, mart, corner]) pave(vpath(l.door[0], l.z1 - 1, FRONT), 1);
// garden: a rounded square walk with a cross, flower beds in the four quarters, a way down to the promenade
pave(and(roundRect(GARDEN[0] - 9, GARDEN[1] - 9, GARDEN[0] + 10, GARDEN[1] + 10, 4), not(roundRect(GARDEN[0] - 6, GARDEN[1] - 6, GARDEN[0] + 7, GARDEN[1] + 7, 2))), 1);
pave(or(vpath(GARDEN[0], GARDEN[1] - 8, GARDEN[1] + 8), hpath(GARDEN[1], GARDEN[0] - 8, GARDEN[0] + 8), circle(GARDEN[0] + 0.5, GARDEN[1] + 0.5, 3.5)), 1);
pave(vpath(GARDEN[0], GARDEN[1] + 9, FRONT), 1);
for (const [qx, qz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
  paint(and(rect(GARDEN[0] + 0.5 + qx * 4 - 1.5, GARDEN[1] + 0.5 + qz * 4 - 1.5, GARDEN[0] + 0.5 + qx * 4 + 1.5, GARDEN[1] + 0.5 + qz * 4 + 1.5), onLevel(1)), 'flowers');
// Battle Dome island: forecourt, south to its bridge, east to the stadium bridge
pave(rect(dome.x0, dome.z1, dome.x1, dome.z1 + 4), 2);
pave(vpath(31, dome.z1, 51), 2);
pave(hpath(34, dome.x1, 48), 2);
// stadium island: forecourt, courtyard, south to the town bridge, west to the dome bridge, the Trainer Hall's door
pave(rect(stadium.x0, stadium.z1, stadium.x1, stadium.z1 + 3), 3);
pave(roundRect(84, 29, 99, 39, 3), 3);
pave(vpath(96, 38, 56), 3);
pave(hpath(34, 66, 84), 3);
pave(or(vpath(hall.door[0], hall.z1 - 1, 49), hpath(49, hall.door[0], 96)), 3);

// ---------------- decks: boardwalk, harbour pier, bridges ----------------
const decks = [];
const deck = (x0, z0, x1, z1, axis, lvl) => {
  const cellsList = []; for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) cellsList.push([x, z]);
  const [a0, a1] = axis === 'x' ? [x0, x1 - 1] : [z0, z1 - 1];
  decks.push({ x0, z0, x1, z1, cells: cellsList.length, cellsList, axis, level: lvl, ramp: false, base: 0, ends: [{ at: a0, level: lvl }, { at: a1, level: lvl }] });
};
deck(20, 109, 118, 113, 'x', 1);     // boardwalk along the south shore
deck(110, 113, 114, 124, 'z', 1);    // harbour pier
deck(29, 50, 33, 67, 'z', 2);        // Battle Dome island -> town (stairs at the town end)
deck(48, 32, 68, 36, 'x', 3);        // Battle Dome island -> stadium island (stairs at the dome end)
deck(94, 55, 98, 67, 'z', 3);        // stadium island -> town (two-level stairs at the town end)
// the bridges cross open water: no land under their middles
for (const d of decks.slice(2)) for (const [x, z] of d.cellsList) {
  const along = d.axis === 'x' ? x : z, [a0, a1] = d.axis === 'x' ? [d.x0, d.x1 - 1] : [d.z0, d.z1 - 1];
  if (along > a0 + 1 && along < a1 - 1) { ground[z][x] = 'sea'; level[z][x] = 0; }
}

// ---------------- stairs (climbing toward dir) ----------------
const flight = (dir, x0, z0, x1, z1, lo, hi) => { const cells = []; for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) cells.push([x, z]); return { dir, cells, lo, hi }; };
const stairs = [
  flight('N', 29, 67, 33, 68, 1, 2),   // town up onto the Battle Dome bridge
  flight('E', 47, 32, 48, 36, 2, 3),   // Battle Dome island up onto the stadium bridge
  flight('N', 94, 67, 98, 69, 1, 3),   // town up onto the stadium bridge, two levels
  flight('E', 18, 109, 20, 113, 0, 1), // beach up onto the boardwalk
];

// ---------------- railings: boardwalk and pier edges ----------------
const fences = [];
const run = (x0, z0, x1, z1) => { const out = []; for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) out.push([x, z]); return out; };
for (const [x, z] of run(20, 112, 117, 112)) if (x < 110 || x > 113) fences.push([x, z, 'fence', 1]);
for (const [x, z] of [...run(110, 114, 110, 123), ...run(113, 114, 113, 123)]) fences.push([x, z, 'fence', 1]);

// ---------------- ships, signs, props, NPC spots ----------------
const ships = [];
const ship = (role, model, cx, cz, name) => {
  const [minX, minY, maxX, maxY] = BOUNDS[model];
  ships.push({ role, x0: Math.floor(cx + minX), z0: Math.floor(cz - maxY), x1: Math.ceil(cx + maxX), z1: Math.ceil(cz - minY), cx, cz });
  buildings.push({ id: role, model, kind: 'ship', x: cx, z: cz, level: 0, rot: 0, name });
};
ship('event_ferry', 'c13_ship_01', 119.5, 117, 'Event Ferry');      // moored east of the pier
ship('journeys_ferry', 'c03_ship_02', 99, 118, 'Journeys Ferry');   // moored west of the pier, south of the boardwalk
// a signpost left of each door ("for" ties it to its building, so it moves with it when the map is edited)
const signSpots = buildings.filter((b) => b.door).map((b) => ({ x: b.door[0] - 2, z: b.door[1] + 1, name: b.name, level: b.level, for: b.id }));
const props = [];
const prop = (id, model, x, z, lvl, extra = {}) => props.push({ id, model, x, y: z, level: lvl, rot: 0, block: true, ...extra });
// landmarks are also placed in the map as model tiles (tile: true), like the buildings; everything else is left to dress by hand
prop('plaza_fountain', 'wbt_fountain', PLAZA[0] + 0.5, PLAZA[1] + 0.5, 1, { tile: true });
prop('garden_fountain', 'c01fountain_01', GARDEN[0] + 0.5, GARDEN[1] + 0.5, 1, { tile: true });
prop('stadium_statue', 'c5_statue_01', 105.5, 33.5, 3, { tile: true });
signSpots.forEach((s) => prop('sign_' + s.for, 'board_a', s.x + 0.5, s.z + 0.75, s.level, { for: s.for }));
const reserved = (x, z) => signSpots.some((s) => Math.abs(s.x - x) <= 1 && Math.abs(s.z - z) <= 1) || props.some((p) => Math.abs(p.x - x - 0.5) < 3 && Math.abs(p.y - z - 0.5) < 3);

// ---------------- trees: lines along the coasts, groves in the open lawns ----------------
// a 2x2 tree may stand where its 4x4 neighbourhood is level grass (clear of cliff edges), a tile off any path,
// two off any lot and clear of props, doorsteps and bridge landings
const isGrassAt = (x, z, l) => at(x, z) && ground[z][x] === 'grass' && level[z][x] === l;
const edgeDist = Array.from({ length: H }, () => Array(W).fill(99));
{ const q = [];
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const l = level[z][x], land = ground[z][x] !== 'sea';
    if (land && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => !at(x + dx, z + dz) || level[z + dz][x + dx] !== l || ground[z + dz][x + dx] === 'sea')) { edgeDist[z][x] = 0; q.push([x, z]); }
  }
  for (let i = 0; i < q.length; i++) { const [x, z] = q[i]; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = x + dx, b = z + dz;
    if (at(a, b) && ground[b][a] !== 'sea' && level[b][a] === level[z][x] && edgeDist[b][a] > edgeDist[z][x] + 1) { edgeDist[b][a] = edgeDist[z][x] + 1; q.push([a, b]); } } } }
const nearPath = (x, z, r) => { for (let b = z - r; b <= z + r + 1; b++) for (let a = x - r; a <= x + r + 1; a++) if (at(a, b) && ['pave', 'brick', 'flowers'].includes(ground[b][a])) return true; return false; };
const stairCell = new Set(stairs.flatMap((s) => s.cells.map(([x, z]) => x + ',' + z)));
const deckCell = new Set(decks.flatMap((d) => d.cellsList.map(([x, z]) => x + ',' + z)));
const trees = [], treeAt = new Set();
const canTree = (x, z) => {
  const l = level[z]?.[x];
  for (let b = z - 1; b <= z + 2; b++) for (let a = x - 1; a <= x + 2; a++) if (!isGrassAt(a, b, l) || stairCell.has(a + ',' + b) || deckCell.has(a + ',' + b)) return false;
  for (let b = z - 1; b <= z + 2; b++) for (let a = x - 1; a <= x + 2; a++) if (treeAt.has(a + ',' + b)) return false;
  return !nearPath(x, z, 1) && !lotCover(2)(x + 1, z + 1) && !reserved(x, z) && !(z >= FRONT - 1);
};
for (let z = 0; z < H - 1; z++) for (let x = 0; x < W - 1; x++) {
  if (!TREES || !canTree(x, z)) continue;
  const d = edgeDist[z][x], coast = d <= 3 && sample(SPARSE, x, z) > 0.28, grove = d > 3 && sample(GROVE, x, z) > 0.66 && sample(SPARSE, x, z) > 0.35;
  if (!coast && !grove) continue;
  trees.push({ x0: x, z0: z, x1: x + 2, z1: z + 2, cx: x + 1, cz: z + 1, tile: (x + z) % 4 < 2 ? 879 : 881 });
  for (let b = z; b < z + 2; b++) for (let a = x; a < x + 2; a++) treeAt.add(a + ',' + b);
}
const parasols = [[10, 98], [16, 106], [8, 108], [22, 116]].map(([x, z]) => ({ cx: x, cz: z }));
const towels = [[12, 101], [18, 111], [11, 113]].map(([x, z]) => ({ cx: x + 0.5, cz: z + 0.5, x0: x, x1: x + 1, z0: z, z1: z + 2 }));
const signs = [{ role: 'event', x: 114.5, z: 118 }, { role: 'journeys', x: 109.5, z: 118 }];

fs.writeFileSync(process.argv[2], JSON.stringify({ source: 'victory-design-1to1', name: 'VictoryIsland', width: W, height: H, ground, level, surface: level,
  fences, stairs, lots, ships, decks, trees, parasols, towels, signs, fountain: [PLAZA[0] + 0.5, PLAZA[1] + 0.5], fountains: [[GARDEN[0] + 0.5, GARDEN[1] + 0.5]] }));

// ---------------- Godot hub layout ----------------
const named = buildings.filter((b) => b.kind === 'building');
const godot = {
  name: 'Victory Island',
  data: 'victory_island',
  spawn: { x: AVENUE, y: PLAZA[1] + 11, facing: 'up' },
  buildings: buildings.map((b) => ({ id: b.id, model: b.model, kind: b.kind, x: b.x, y: b.z, level: b.level, rot: b.rot, ...(b.door ? { door: b.door } : {}), name: b.name })),
  props,
  signs: signSpots.map((s) => ({ x: s.x, y: s.z, text: [s.name], for: s.for })),
  npcs: [
    { id: 'journeys_shipmaster', name: 'Journeys Portmaster', sprite: 'SPRITE_SEAMAN_2', x: 111, y: 119, facing: 'left', movement: 0, role: 'journeys',
      text: ['Ahoy! The Journeys ferry sails to every game you have imported.', 'Pick a journey with me once the ferry is ready.'] },
    { id: 'event_shipmaster', name: 'Event Portmaster', sprite: 'SPRITE_SEAMAN_2', x: 112, y: 121, facing: 'right', movement: 0, role: 'event',
      text: ['The Event Ferry runs to special islands.', 'No events are scheduled right now.'] },
  ],
  zones: [
    { name: 'Central Plaza', x: PLAZA[0] + 0.5, y: PLAZA[1] + 0.5, radius: 12 },
    { name: 'Garden', x: GARDEN[0] + 0.5, y: GARDEN[1] + 0.5, radius: 12 },
    { name: 'Beach', x: 12, y: 104, radius: 12 },
    { name: 'Boardwalk', x: 70, y: 110, radius: 30 },
    { name: 'Harbour', x: 112, y: 118, radius: 8 },
    { name: 'Battle Dome', x: 30, y: 33, radius: 18 },
    { name: 'PWT Stadium', x: 90, y: 28, radius: 22 },
    ...named.filter((b) => ['apartments', 'auction', 'lighthouse'].includes(b.id)).map((b) => ({ name: b.name, x: b.door[0] + 0.5, y: b.door[1] + 1.5, radius: 5 })),
  ],
};
fs.writeFileSync(process.argv[3], JSON.stringify(godot, null, 2) + '\n');

// report: lots must not touch each other, the sea or another level
const problems = [];
for (let i = 0; i < lots.length; i++) for (let j = i + 1; j < lots.length; j++) {
  const a = lots[i], b = lots[j];
  if (a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1) problems.push(`overlap ${a.role}/${b.role}`);
}
for (const l of lots) {
  const lv = buildings.find((b) => b.id === l.role).level;
  for (let z = l.z0; z < l.z1; z++) for (let x = l.x0; x < l.x1; x++)
    if (!at(x, z) || ground[z][x] === 'sea' || level[z][x] !== lv) { problems.push(`${l.role} off its ground at ${x},${z}`); z = l.z1; break; }
}
const hist = {}; ground.flat().forEach((g) => (hist[g] = (hist[g] || 0) + 1));
console.log('ground', JSON.stringify(hist), 'lots', lots.length, 'decks', decks.length, 'stairs', stairs.length, 'fences', fences.length, 'trees', trees.length, 'props', props.length);
console.log(problems.length ? problems.join('\n') : 'no lot problems');
