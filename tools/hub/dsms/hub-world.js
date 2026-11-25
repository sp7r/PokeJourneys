// Builds the hub world as a DS Map Studio project (4x3 maps, 128x96 tiles) after the owner's sketch: one main island
// with a beach and a raised boardwalk of shops on its south side, a pier with two ferries at its east end and a
// lighthouse on a peninsula that climbs in steps; two higher islands to the north (battle dome, colosseum) joined to the
// main island and to each other by plank bridges; the daycare on a headland under tall cliffs that run off the west edge.
// The ground layout goes through victory-map.js, then every building and prop is converted from its ripped model at
// native size (1:1, 16 DS units per tile, glb-to-obj.js), appended to the map's tileset once (TileImport) and placed as
// a model tile. Building footprints are marked solid in the .per collision files.
// Coordinates below are map tiles, x east, y south (row 0 is the north edge). A model is given by the tile its
// footprint is centred on.
// Usage: node hub-world.js [outDir] [--force]   (default C:/Projects/hub-work/dsms/hub-world; --force replaces an existing, maybe hand-edited map)
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { convert } = require('./glb-to-obj.js');

const WORK = process.env.DSMS_WORK || 'C:/Projects/hub-work/dsms';
const HUB = path.dirname(WORK);
const OUT = process.argv.slice(2).find((a) => !a.startsWith('--')) || path.join(WORK, 'hub-world');
const NAME = 'HubWorld', TILESET = 'JourneysHub.pdsts';
const LIB = process.env.DSMS_LIB || path.join(WORK, 'app/Pokemon DS Map Studio-2.2/lib');
const JAVA = path.join(process.env.JAVA_HOME || 'C:/Program Files/Microsoft/jdk-17.0.20.101-hotspot', 'bin/java');
const CP = ['Pokemon DS Map Studio-2.2.jar', 'jogamp-fat.jar', 'graphicslib3D.jar'].map((n) => path.join(LIB, n)).concat(path.join(WORK, 'tools-build')).join(path.delimiter);
const FOLDERS = ['buildings-glb', 'houses-glb', 'decor-glb', 'props-glb', 'pwt-glb', 'pokeathlon-glb', 'gen4-glb/hg2', 'gen4-glb/hg', 'gen4-glb/pt'];

if (fs.existsSync(path.join(OUT, NAME + '.pdsmap')) && !process.argv.includes('--force')) {
  console.error(`${OUT}/${NAME}.pdsmap exists and may hold hand edits; pass --force to replace it.`); process.exit(1);
}

// ---------------- ground layout ----------------
// Levels (one level is one cliff step): sea and beach 0, main island and boardwalk 1, daycare headland 2,
// battle dome island 3, colosseum island 4, west cliffs 5; the lighthouse peninsula climbs 1 -> 2 -> 3.
const LV = { main: 1, daycare: 2, dome: 3, colosseum: 4, cliffs: 5 };
const W = 128, H = 96;
const ground = Array.from({ length: H }, () => Array(W).fill('sea'));
const level = Array.from({ length: H }, () => Array(W).fill(0));
const set = (x, y, g, l) => { if (x < 0 || y < 0 || x >= W || y >= H) return; if (g) ground[y][x] = g; if (l !== undefined) level[y][x] = l; };
const fill = (x0, y0, x1, y1, g, l) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, g, l); };
const inPoly = (pts, x, y) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const poly = (pts, g, l) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inPoly(pts, x + 0.5, y + 0.5)) set(x, y, g, l); };
const ellipse = (cx, cy, rx, ry, g, l) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) set(x, y, g, l); };
const disc = (cx, cy, r, g, keep) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r && (!keep || keep(x, y))) set(x, y, g); };
const seaToZero = () => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (ground[y][x] === 'sea') level[y][x] = 0; };

// west cliffs (run off the west and north-west edges), with the daycare headland in a nook at their foot
poly([[-1, 8], [26, 8], [27, 14], [22, 22], [15, 26], [12, 32], [11, 44], [9, 56], [4, 64], [-1, 66]], 'grass', LV.cliffs);
poly([[13, 29], [19, 27], [25, 28], [29, 32], [29, 38], [26, 42], [19, 43], [13, 41], [12, 35]], 'grass', LV.daycare);
// beach (south-west), then the main island over it and the lighthouse peninsula
poly([[14, 56], [22, 62], [40, 62], [40, 79], [60, 79], [66, 83], [57, 89], [36, 89], [22, 83], [14, 72]], 'beach', 0);
poly([[18, 52], [22, 49], [32, 47], [44, 46], [60, 46], [76, 44], [94, 45], [104, 46], [106, 50], [106, 74], [57, 74], [57, 63], [22, 63], [17, 58]], 'grass', LV.main);
poly([[103, 46], [110, 43], [117, 42], [122, 46], [122, 54], [118, 58], [108, 58], [103, 58]], 'grass', LV.main);
fill(109, 42, 112, 58, null, 2); fill(113, 42, 122, 58, null, 3);
seaToZero();
// north islands
ellipse(48, 28, 13, 12, 'grass', LV.dome);
ellipse(88, 20, 17, 15, 'grass', LV.colosseum);
seaToZero();

// --- paving ---
// central courtyard: a Poke Ball - paving disc, the north half brick (red), fountain in the middle
const CX = 73, CY = 56;
disc(CX, CY, 9.5, 'pave'); disc(CX, CY, 8, 'brick', (x, y) => y + 0.5 < CY - 1);
// walks: dome bridge and colosseum bridge down to the courtyard, garden walk west, lighthouse walk east,
// avenue south to the boardwalk, and the paved shop row along the south edge
fill(44, 46, 48, 58, 'pave'); fill(44, 55, 66, 58, 'pave');
fill(85, 45, 89, 50, 'pave'); fill(78, 47, 89, 50, 'pave');
fill(81, 49, 108, 52, 'pave'); fill(109, 49, 122, 52, 'pave');
fill(71, 63, 75, 73, 'pave');
fill(57, 63, 106, 73, 'pave');
fill(22, 48, 26, 58, 'pave'); fill(22, 55, 44, 58, 'pave');
// garden (west of the courtyard): flower beds round a dirt cross, berry stalls on its walks
fill(28, 47, 43, 54, 'flowers'); fill(28, 59, 43, 62, 'flowers');
fill(28, 50, 43, 52, 'path'); fill(34, 47, 37, 54, 'path');
// north islands: paved courts for the buildings, ledges where the bridges land
ellipse(48, 27, 10.5, 9, 'pave'); fill(45, 35, 48, 42, 'pave');
ellipse(88, 19, 13.5, 10.5, 'pave'); fill(85, 28, 89, 37, 'pave'); fill(69, 23, 79, 27, 'pave');
fill(45, 39, 48, 42, 'pave', LV.main);      // dome south ledge + flight rows
fill(85, 33, 89, 37, 'pave', LV.main);      // colosseum south ledge + flight rows
fill(69, 23, 73, 27, 'pave', LV.dome);      // colosseum west ledge + flight row
// daycare headland: paved yard by the house, walk to its bridge
fill(20, 31, 25, 38, 'pave'); fill(21, 38, 24, 42, 'pave');

// stair flights: { dir uphill, cells of the bottom row, lo, hi } (victory-map.js carves one row per level)
const flight = (dir, cells, lo, hi) => ({ dir, cells, lo, hi });
const stairs = [
  flight('N', [[45, 40], [46, 40], [47, 40]], LV.main, LV.dome),          // up the battle dome island
  flight('N', [[86, 35], [87, 35], [88, 35]], LV.main, LV.colosseum),     // up the colosseum island
  flight('E', [[73, 24], [73, 25], [73, 26]], LV.dome, LV.colosseum),     // dome bridge -> colosseum
  flight('E', [[109, 49], [109, 50], [109, 51]], 1, 2),                   // lighthouse peninsula, first step
  flight('E', [[113, 49], [113, 50], [113, 51]], 2, 3),                   // lighthouse peninsula, top
  flight('N', [[28, 63], [29, 63], [30, 63]], 0, LV.main),                // main island down to the beach
];

// daycare yard fence on the headland (gap facing the house)
const fences = [];
for (let x = 14; x <= 19; x++) for (const y of [33, 40]) fences.push([x, y, 'fence', LV.daycare]);
for (let y = 34; y <= 39; y++) { fences.push([14, y, 'fence', LV.daycare]); if (y !== 36 && y !== 37) fences.push([19, y, 'fence', LV.daycare]); }

// --- trees (Platinum 2x2): thick on the cliff tops, a fringe round each island ---
const coast = Array.from({ length: H }, () => Array(W).fill(99)); // steps to the nearest sea or level change
{
  const q = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const edge = ground[y][x] === 'sea' || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => level[y + b]?.[x + a] !== undefined && level[y + b][x + a] !== level[y][x]);
    if (edge) { coast[y][x] = 0; q.push([x, y]); }
  }
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i];
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
      const nx = x + a, ny = y + b;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && coast[ny][nx] > coast[y][x] + 1) { coast[ny][nx] = coast[y][x] + 1; q.push([nx, ny]); }
    }
  }
}
const fenceAt = new Set(fences.map(([x, y]) => x + ',' + y));
const trees = [];
for (let y = 0; y < H - 1; y += 2) for (let x = 0; x < W - 1; x += 2) {
  const block = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([a, b]) => [x + a, y + b]);
  if (!block.every(([a, b]) => ground[b][a] === 'grass' && level[b][a] === level[y][x] && coast[b][a] >= 1 && !fenceAt.has(a + ',' + b))) continue;
  const clear = [-1, 0, 1, 2].every((b) => [-1, 0, 1, 2].every((a) => !['pave', 'brick', 'path'].includes(ground[y + b]?.[x + a])));
  if (!clear) continue;
  const near = Math.min(...block.map(([a, b]) => coast[b][a])), lv = level[y][x];
  if (lv === LV.cliffs || near <= (lv === LV.main ? 3 : 2)) trees.push({ x0: x, z0: y, tile: (x / 2 + y / 2) % 2 ? 879 : 881 });
}

// plank decks (all three wide): boardwalk, ferris wheel deck, pier, and the bridges
const rectDeck = (x0, y0, x1, y1, axis, lo, hi = lo, ramp = false) => {
  const cellsList = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cellsList.push([x, y]);
  const [a0, a1] = axis === 'x' ? [x0, x1] : [y0, y1];
  return { x0, z0: y0, x1: x1 + 1, z1: y1 + 1, cellsList, axis, ramp, ends: [{ at: a0, level: lo }, { at: a1, level: hi }] };
};
const decks = [
  rectDeck(40, 74, 112, 76, 'x', LV.main),                  // boardwalk (raised over the sand and the sea)
  rectDeck(40, 63, 56, 73, 'z', LV.main),                   // ferris wheel deck
  rectDeck(113, 59, 115, 93, 'z', LV.main),                 // pier
  rectDeck(45, 43, 47, 45, 'z', LV.main),                   // main island -> battle dome ledge
  rectDeck(86, 38, 88, 44, 'z', LV.main),                   // main island -> colosseum ledge
  rectDeck(61, 24, 68, 26, 'x', LV.dome),                   // battle dome -> colosseum ledge
  rectDeck(22, 43, 24, 48, 'z', LV.daycare, LV.main, true), // daycare headland -> main island (steps down mid-bridge)
];

const layout = { name: NAME, width: W, height: H, ground, level, decks, fences, trees, stairs };
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'hub-layout.json'), JSON.stringify(layout));

// ---------------- tileset and terrain ----------------
const BASE = path.join(WORK, 'hub-tileset');
for (const f of fs.readdirSync(BASE)) if (f.endsWith('.png') || f === TILESET) fs.copyFileSync(path.join(BASE, f), path.join(OUT, f));
for (const f of fs.readdirSync(OUT)) if (f === 'model-tile-index.txt') fs.unlinkSync(path.join(OUT, f)); // fresh tileset, fresh index
const gen = spawnSync('node', [path.join(__dirname, 'victory-map.js'), path.join(OUT, 'hub-layout.json'), OUT, path.join(WORK, 'tile-sig.json'), path.join(WORK, 'tile-z.json')], { encoding: 'utf8' });
if (gen.status !== 0) throw new Error('victory-map.js failed\n' + gen.stderr);
console.log(gen.stdout.slice(gen.stdout.lastIndexOf('stairs')).split('\n').filter((l) => /^(stairs|no problems|problems|cliff|ground)/.test(l)).join('\n'));

// ---------------- buildings and props (native size) ----------------
// solid: footprint blocks walking; layer: 7 buildings, 4 small props (one model tile per cell and layer)
const B = (id, model, cx, cy, extra = {}) => ({ id, model, cx, cy, layer: 7, solid: true, ...extra });
const P = (id, model, cx, cy, extra = {}) => ({ id, model, cx, cy, layer: 4, solid: true, ...extra });
const placements = [
  // north islands
  B('colosseum', 'c04ballpark_01', 88, 18.5),        // PvP: ranked and tournaments
  B('battle_dome', 'poke_c_dome2', 48, 27),          // PvE: bot battles
  // daycare under the cliffs
  B('daycare', 'c6_house_01', 22.5, 34),
  // main island: courtyard fountain, garden stalls, move tutor west of the courtyard, apartments to the east
  B('fountain', 'c03_fountain_01', CX, CY),
  B('flower_stall', 'rr_hanaya_01', 40, 61),
  P('berry_stall_1', 'cart_01', 30.5, 51), P('berry_stall_2', 'cart_01', 41, 51),
  P('berry_stall_3', 'cart_01', 30.5, 57.5), P('berry_stall_4', 'cart_01', 38, 57.5),
  B('garden_arch', 'c01arch_01', 46, 51, { solid: false }),
  B('move_tutor', 'c7_house_02', 61, 51),
  B('apartments', 't2_build01', 97, 47.5),
  // shop row: doors face south onto the boardwalk
  B('ferris_wheel', 'c04_fwheel_01', 48, 69, { level: LV.main }),
  B('costume_shop', 'c1_rest_01', 61, 70),
  B('tm_shop', 'c13_house_04', 67.5, 70),
  B('item_shop', 'c5_market_01', 81.5, 68.6),
  B('auction_house', 'c2_museum_01', 92, 69.3),
  B('pokemon_center', 'pc_01', 102, 70.3),
  // lighthouse on the peninsula top, ferries either side of the pier
  B('lighthouse', 'c5_lhouse_01', 118, 48.5),
  B('region_ferry', 'c13_ship_01', 108.5, 87.5),
  B('event_ferry', 'c03_ship_02', 119.5, 87.5, { rot: 90 }),
  // lamps along the boardwalk, benches round the courtyard, parasols on the beach
  ...[[44, 76], [58, 76], [70, 76], [86, 76], [100, 76]].map(([x, y], i) => P('lamp_' + i, 'c03_slamp_02', x, y, { level: LV.main, solid: false })),
  ...[[64, 50], [82, 50], [64, 61.5], [82, 61.5]].map(([x, y], i) => P('bench_' + i, 'poke_c_bench', x, y)),
  ...[[26, 70], [33, 76], [46, 83], [55, 84], [28, 80]].map(([x, y], i) => P('parasol_' + i, 'o_parasol_02', x, y)),
];

const lines = fs.readFileSync(path.join(OUT, NAME + '.pdsmap'), 'utf8').split(/\r?\n/);
const ts = path.join(OUT, TILESET);
const tiles = new Map(); // model key -> { id, w, h, bounds }
const want = [...new Map(placements.map((p) => [p.model + (p.rot ? '_r' + p.rot : ''), p])).entries()];
const list = [], info = {};
for (const [key, p] of want) {
  const glb = FOLDERS.map((f) => path.join(HUB, f, p.model, p.model + '.glb')).find((f) => fs.existsSync(f));
  if (!glb) throw new Error('no ripped model for ' + p.model);
  const dir = path.join(WORK, 'model-tiles-1to1', key);
  const r = convert(glb, dir, key, 1, 16, p.rot || 0); // 16 DS units to a tile: native size, never rescaled
  info[key] = r;
  list.push([dir.split(path.sep).join('/'), key + '.obj', r.w, r.h].join('\t'));
}
const listFile = path.join(OUT, 'import-list.txt');
fs.writeFileSync(listFile, list.join('\n') + '\n');
const imp = spawnSync(JAVA, ['-Djava.awt.headless=true', '-cp', CP, 'TileImport', ts, ts, listFile], { encoding: 'utf8' });
if (imp.status !== 0) throw new Error('TileImport failed\n' + imp.stderr);
const index = [];
for (const l of imp.stdout.split(/\r?\n/)) {
  const m = l.match(/^(\d+)\t([^\t]+)\.obj\t(\d+)x(\d+)$/);
  if (!m) continue;
  const r = info[m[2]];
  tiles.set(m[2], { id: +m[1], w: r.w, h: r.h, bounds: r.bounds });
  index.push(`${m[1]}\t${m[2]}.obj\t${r.w}x${r.h}\t${r.bounds.map((v) => +v.toFixed(3)).join(',')}`);
}
fs.writeFileSync(path.join(OUT, 'model-tile-index.txt'), index.join('\n') + '\n');

// map grid access: tile rows run bottom-up inside each 32x32 map, maps are numbered west->east, north->south
const maps = new Map();
for (let i = 0; i < lines.length; i++) if (lines[i] === 'mapstart') {
  const key = lines[i + 1].trim(); const m = { tg: [], hg: [] }; maps.set(key, m);
  for (let k = i + 2; lines[k] !== 'mapend'; k++) { if (lines[k] === 'tilegrid') m.tg.push(k); if (lines[k] === 'heightgrid') m.hg.push(k); }
}
const setCell = (gx, gy, layer, id, h) => {
  const m = maps.get(`${Math.floor(gx / 32)} ${Math.floor(gy / 32)}`); if (!m) return false;
  const r = 31 - (gy % 32), x = gx % 32;
  for (const [hdr, v] of [[m.tg[layer], id], [m.hg[layer], h]]) {
    const row = lines[hdr + 1 + r].trim().split(/\s+/).map(Number);
    if (hdr === m.tg[layer] && row[x] !== -1) return false;
    row[x] = v; lines[hdr + 1 + r] = row.join(' ') + ' ';
  }
  return true;
};
const tilesJson = JSON.parse(fs.readFileSync(path.join(OUT, 'tiles.json'), 'utf8'));
const solid = [];
const report = [];
for (const p of placements) {
  const key = p.model + (p.rot ? '_r' + p.rot : ''), t = tiles.get(key);
  // the model's footprint is centred on its w x h tile, whose anchor is the south-west cell
  const ax = Math.round(p.cx - t.w / 2), ay = Math.round(p.cy + t.h / 2 - 1);
  const lv = p.level ?? tilesJson.level[Math.min(H - 1, Math.round(p.cy))][Math.min(W - 1, Math.round(p.cx))];
  if (!setCell(ax, ay, p.layer, t.id, lv)) { report.push(`!! ${p.id}: cell ${ax},${ay} layer ${p.layer} taken or outside`); continue; }
  const [minX, minY, maxX, maxY] = t.bounds, gx0 = ax + t.w / 2 - (maxX - minX) / 2, gy1 = ay + 1 - t.h / 2 + (maxY - minY) / 2;
  const rect = [gx0, gy1 - (maxY - minY), gx0 + (maxX - minX), gy1]; // west, north, east, south edges in tiles
  report.push(`${p.id.padEnd(16)} ${key.padEnd(18)} tile ${t.id} at ${ax},${ay} level ${lv}  covers x ${rect[0].toFixed(1)}..${rect[2].toFixed(1)} y ${rect[1].toFixed(1)}..${rect[3].toFixed(1)}`);
  if (p.solid) solid.push(rect);
}
fs.writeFileSync(path.join(OUT, NAME + '.pdsmap'), lines.join('\n'));

// collision: cells mostly under a solid footprint are blocked (.per rows north-first, byte 2 bit 0x80)
let blocked = 0;
for (const [mk] of maps) {
  const [mx, my] = mk.split(' ').map(Number), file = path.join(OUT, `${NAME}_${String(mx).padStart(2, '0')}_${String(my).padStart(2, '0')}.per`);
  const per = fs.readFileSync(file);
  for (let r = 0; r < 32; r++) for (let x = 0; x < 32; x++) {
    const cx = mx * 32 + x + 0.5, cy = my * 32 + r + 0.5;
    if (solid.some(([w, n, e, s]) => cx > w + 0.3 && cx < e - 0.3 && cy > n + 0.3 && cy < s - 0.3)) { per[(r * 32 + x) * 2 + 1] = 0x80; blocked++; }
  }
  fs.writeFileSync(file, per);
}
fs.writeFileSync(path.join(OUT, 'placements.json'), JSON.stringify(placements, null, 1));
console.log(report.join('\n'));
console.log(`${placements.length} models placed, ${blocked} cells blocked under buildings`);
