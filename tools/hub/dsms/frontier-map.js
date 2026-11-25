// Builds a Battle Frontier style hub as a DS Map Studio project (4x4 maps, 128x128 tiles), traced from a reference
// picture at 16 px per tile: a main island of roads and orange plazas, a stepped pyramid with a tower to the north, a
// castle island to the north-east, a forested terrace with a moated shrine to the west, a raised desert temple to the
// east, a cruise dock and a south pier. Heights step down one level every two tiles towards lower ground (cliff band and
// a grass ledge), so no cliff piece is ever stacked. Ground goes through victory-map.js; every building and prop is
// converted from its ripped model at native size (1:1, 16 DS units per tile) and placed as a model tile.
// Coordinates below are reference-picture pixels (x east, y south); px() / py() turn them into map tiles.
// Usage: node frontier-map.js [outDir] [--force]   (default C:/Projects/hub-work/dsms/frontier)
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { convert } = require('./glb-to-obj.js');

const WORK = process.env.DSMS_WORK || 'C:/Projects/hub-work/dsms';
const HUB = path.dirname(WORK);
const OUT = process.argv.slice(2).find((a) => !a.startsWith('--')) || path.join(WORK, 'frontier');
const NAME = 'Frontier', TILESET = 'JourneysHub.pdsts';
const LIB = process.env.DSMS_LIB || path.join(WORK, 'app/Pokemon DS Map Studio-2.2/lib');
const JAVA = path.join(process.env.JAVA_HOME || 'C:/Program Files/Microsoft/jdk-17.0.20.101-hotspot', 'bin/java');
const CP = ['Pokemon DS Map Studio-2.2.jar', 'jogamp-fat.jar', 'graphicslib3D.jar'].map((n) => path.join(LIB, n)).concat(path.join(WORK, 'tools-build')).join(path.delimiter);
const FOLDERS = ['buildings-glb', 'houses-glb', 'decor-glb', 'props-glb', 'pwt-glb', 'pokeathlon-glb', 'gen4-glb/pt', 'gen4-glb/hgx', 'gen4-glb/hgbf', 'gen4-glb/hg2', 'gen4-glb/hg'];

if (fs.existsSync(path.join(OUT, NAME + '.pdsmap')) && !process.argv.includes('--force')) {
  console.error(`${OUT}/${NAME}.pdsmap exists and may hold hand edits; pass --force to replace it.`); process.exit(1);
}

// ---------------- reference pixels -> tiles ----------------
const W = 128, H = 128, OX = 4, OY = 0; // the pyramid and the forest run off the top edge, as in the picture
const px = (v) => Math.round(v / 16) + OX, py = (v) => Math.round(v / 16) + OY;
const T = Array.from({ length: H }, () => Array(W).fill(0));       // target level (before stepping)
const ground = Array.from({ length: H }, () => Array(W).fill('sea'));
const inMap = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const rect = (x0, y0, x1, y1, g, lv) => { for (let y = py(y0); y < py(y1); y++) for (let x = px(x0); x < px(x1); x++) if (inMap(x, y)) { if (g) ground[y][x] = g; if (lv !== undefined) T[y][x] = lv; } };

// ---------------- land masses and target levels ----------------
// west forest terrace with the moated shrine
rect(15, 0, 535, 940, 'grass', 4); rect(15, 940, 165, 1520, 'grass', 4);
rect(0, 0, 120, 60, 'sea', 0); rect(395, 0, 445, 60, 'sea', 0);           // notches along the top
// main island (and its south-west strip), the south avenue, the east block
rect(160, 580, 1240, 1480, 'grass', 2); rect(1235, 900, 1830, 1700, 'grass', 2);
rect(160, 1480, 990, 1610, 'grass', 2); rect(600, 1480, 800, 1815, 'grass', 2);
rect(1300, 1700, 1650, 1730, 'grass', 2);
// quays one level down: the cruise dock and the south pier
rect(945, 1600, 1300, 1705, 'pave', 1); rect(445, 1815, 810, 1915, 'pave', 1);
// stepped pyramid to the north: base 2, a terrace every couple of tiles up to the tower plaza at 7
rect(565, 0, 1175, 550, 'grass', 2);
[[600, 1145, 505, 3], [630, 1115, 470, 4], [655, 1085, 440, 5], [680, 1060, 400, 6], [710, 1025, 330, 7]].forEach(([x0, x1, y1, lv]) => rect(x0, 0, x1, y1, null, lv));
// castle island to the north-east
rect(1240, 295, 1755, 865, 'grass', 2);
// desert temple to the east: sand rising in two rings to the temple plaza
rect(1385, 1040, 1800, 1610, 'beach', 2); rect(1410, 1065, 1780, 1590, 'beach', 3); rect(1450, 1095, 1745, 1555, 'beach', 4);

// west shrine: sunken moat (two levels down, filled with water after the terrain is built), the shrine platform, the
// gate islet and the causeway to the south bank
const MOAT = 3;
rect(165, 205, 440, 800, 'grass', MOAT);
rect(200, 300, 410, 610, 'pave', 4); rect(235, 665, 370, 745, 'pave', 4); rect(270, 745, 335, 800, 'path', 4);

// ---------------- paving ----------------
// gray roads
const road = (x0, y0, x1, y1) => rect(x0, y0, x1, y1, 'pave');
road(540, 600, 1205, 650); road(540, 600, 575, 990); road(1170, 600, 1205, 990);
road(190, 960, 1520, 1000); road(190, 960, 225, 1510); road(190, 1475, 1360, 1515);
road(1010, 990, 1045, 1480); road(690, 990, 725, 1480); road(530, 1085, 1010, 1120);
road(535, 1190, 765, 1290); road(1110, 1480, 1150, 1600); road(1330, 1480, 1360, 1720); road(1330, 1690, 1640, 1725);
road(1480, 930, 1520, 1000); road(270, 800, 335, 960);
// courts in front of the north buildings and the dome
road(575, 655, 840, 950); road(875, 655, 1165, 950); road(1060, 1000, 1355, 1450);
// orange plazas (brick) between the roads, with grass courts
rect(230, 1000, 1010, 1475, 'brick'); rect(255, 1025, 505, 1450, 'pave');  // cathedral court
rect(560, 1300, 645, 1440, 'grass'); rect(775, 1270, 1000, 1440, 'grass'); rect(775, 1000, 1000, 1080, 'grass');
rect(920, 1130, 1000, 1200, 'grass');
rect(600, 1480, 800, 1815, 'brick'); rect(195, 1515, 990, 1600, 'brick');  // south avenue and emblem plaza
rect(1180, 1180, 1235, 1430, 'brick');                                     // red carpet to the dome
// castle courtyard, pyramid stairs and tower plaza, desert temple plaza
rect(1285, 380, 1715, 820, 'pave'); rect(835, 300, 875, 560, 'pave'); rect(710, 0, 1025, 330, 'pave');
rect(1500, 1100, 1700, 1550, 'path');

// keep only edge pieces the tileset has: brick only meets paving, paving does not meet sand, dirt only meets grass
for (let pass = 0; pass < 2; pass++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const g = ground[y][x]; const nb = []; for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) if (inMap(x + a, y + b) && (a || b)) nb.push(ground[y + b][x + a]);
  if (g === 'brick' && nb.some((n) => !['brick', 'pave'].includes(n))) ground[y][x] = 'pave';
  if (g === 'pave' && nb.includes('beach')) ground[y][x] = 'grass';
  if (g === 'path' && nb.some((n) => ['pave', 'brick', 'beach'].includes(n))) ground[y][x] = 'grass';
}

// ---------------- stepped heights: never more than one level per two tiles ----------------
const level = Array.from({ length: H }, () => Array(W).fill(0));
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (ground[y][x] === 'sea') continue;
  let lv = T[y][x];
  for (let b = -14; b <= 14 && lv > 0; b++) for (let a = -14; a <= 14; a++) {
    const nx = x + a, ny = y + b; if (!inMap(nx, ny)) continue;
    const t = ground[ny][nx] === 'sea' ? 0 : T[ny][nx]; if (t >= lv) continue;
    lv = Math.min(lv, t + Math.ceil(Math.max(Math.abs(a), Math.abs(b)) / 2));
  }
  level[y][x] = lv;
}

// stairs: walk a three-wide line and put a flight wherever the level changes by one
const stairs = [];
const stairLine = (xPx, y0Px, y1Px) => {
  const x = px(xPx), ya = py(y0Px), yb = py(y1Px);
  for (let y = ya; y < yb; y++) {
    const a = level[y][x], b = level[y + 1][x]; if (a === b || [x, x + 1, x + 2].some((c) => level[y][c] !== a || level[y + 1][c] !== b)) continue;
    if (Math.abs(a - b) !== 1) continue;
    stairs.push(a > b ? { dir: 'N', cells: [0, 1, 2].map((k) => [x + k, y + 1]), lo: b, hi: a } : { dir: 'S', cells: [0, 1, 2].map((k) => [x + k, y]), lo: a, hi: b });
    for (let k = 0; k < 3; k++) { ground[y][x + k] = ground[y][x + k] === 'brick' ? 'pave' : ground[y][x + k]; }
  }
};
stairLine(838, 300, 520);    // up the pyramid (the bridge reaches its base)
stairLine(288, 740, 990);    // up to the shrine terrace
stairLine(1572, 1540, 1680); // up to the desert temple
stairLine(688, 1760, 1840);  // down to the south pier
stairLine(1100, 1570, 1630); // down to the cruise dock

// plank decks: the pyramid bridge, the castle bridge, the moat bridge
const deck = (x0, y0, x1, y1, lv) => { const cellsList = []; for (let y = py(y0); y < py(y1); y++) for (let x = px(x0); x < px(x0) + 3; x++) cellsList.push([x, y]);
  return { x0: px(x0), z0: py(y0), x1: px(x0) + 3, z1: py(y1), cellsList, axis: 'z', ramp: false, ends: [{ at: py(y0), level: lv }, { at: py(y1) - 1, level: lv }] }; };
const decks = [deck(838, 470, 640, 2), deck(1478, 790, 935, 2), deck(285, 605, 670, 4)];
for (const d of decks) for (const [x, y] of d.cellsList) if (level[y][x] === 0) ground[y][x] = 'sea';

// trees: the west forest (dense), a band along the castle's north wall, the east edge and the desert rim
const trees = [];
const treeZone = (x, y) => (x < px(540) && y < py(1520)) || (y >= py(300) && y < py(400) && x >= px(1330) && x < px(1720)) || (x >= px(1580) && y >= py(900) && y < py(1060)) || (x >= px(1790));
const flatGrass = (x, y) => [[0, 0], [1, 0], [0, 1], [1, 1]].every(([a, b]) => ground[y + b]?.[x + a] === 'grass' && level[y + b][x + a] === level[y][x]);
const clearOf = (x, y) => [-1, 0, 1, 2].every((b) => [-1, 0, 1, 2].every((a) => inMap(x + a, y + b) && level[y + b][x + a] <= level[y][x] && !['pave', 'brick', 'path'].includes(ground[y + b][x + a])));
for (let y = 0; y < H - 1; y += 2) for (let x = 0; x < W - 1; x += 2) if (treeZone(x, y) && flatGrass(x, y) && clearOf(x, y) && T[y][x] !== MOAT) trees.push({ x0: x, z0: y, tile: (x / 2 + y / 2) % 2 ? 879 : 881 });
// palms of the main island stand in for the reference's palm courts
for (const [x, y] of [[600, 1310], [600, 1400], [800, 1290], [930, 1290], [800, 1400], [930, 1400], [480, 1555], [600, 1555], [820, 1555], [930, 1555]]) { const tx = px(x), ty = py(y) - 1; if (flatGrass(tx, ty)) trees.push({ x0: tx, z0: ty, tile: 879 }); }

const layout = { name: NAME, width: W, height: H, ground, level, decks, fences: [], trees, stairs };
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'frontier-layout.json'), JSON.stringify(layout));

// ---------------- tileset and terrain ----------------
const BASE = path.join(WORK, 'hub-tileset');
for (const f of fs.readdirSync(BASE)) if (f.endsWith('.png') || f === TILESET) fs.copyFileSync(path.join(BASE, f), path.join(OUT, f));
const gen = spawnSync('node', [path.join(__dirname, 'victory-map.js'), path.join(OUT, 'frontier-layout.json'), OUT, path.join(WORK, 'tile-sig.json'), path.join(WORK, 'tile-z.json')], { encoding: 'utf8', maxBuffer: 1 << 26 });
if (gen.status !== 0) throw new Error('victory-map.js failed\n' + gen.stderr);
const tail = gen.stdout.split('\n').filter((l) => /^(stairs|no problems|problems|cliff|ground|land filled)/.test(l) || /^(stairs|cliff|ground) .* at /.test(l));
console.log(tail.slice(0, 30).join('\n'));

// ---------------- buildings and props (native size) ----------------
const B = (id, model, x, y, extra = {}) => ({ id, model, cx: px(x) + ((x / 16) % 1), cy: py(y) + ((y / 16) % 1), layer: 7, solid: true, ...extra });
const P = (id, model, x, y, extra = {}) => ({ ...B(id, model, x, y, extra), layer: 4, ...extra });
const placements = [
  B('battle_tower', 'ko_radio', 865, 90),
  B('pwt', 'c5_wbt_01', 720, 780),
  B('statue_court', 'c5_statue_01', 1020, 740),
  B('battle_castle', 'd32_s01', 1500, 590),
  B('battle_dome', 'd32_s03', 1210, 1090),
  B('cathedral', 'd32_s04', 380, 1120),
  B('office', 't7_s02', 590, 1060),
  B('pokemon_center', 'pc_01', 840, 1160),
  B('desert_temple', 'ar_center', 1600, 1180),
  B('shrine', 'en_kabu', 305, 400),
  B('shrine_gate', 'en_gate02', 302, 700),
  B('torii', 'en_gate01', 302, 905, { solid: false }),
  B('south_arch', 'ko_arch', 705, 1735, { solid: false }),
  B('fountain', 'ko_funsui', 705, 1240),
  B('trailer_1', 'c15_trailer_01', 260, 1508), B('trailer_2', 'c15_trailer_01', 370, 1575),
  B('cruise_ship', 'c03_ship_02', 1115, 1765, { level: 0 }),
  B('yacht', 'as_yacht', 530, 1950, { level: 0 }),
  B('stall_1', 'c2_cafe_01', 1050, 1625), B('stall_2', 'c2_cafe_01', 1215, 1625),
  P('parasol_1', 'o_parasol_02', 995, 1660), P('parasol_2', 'o_parasol_02', 1255, 1660),
  ...[[590, 595], [670, 595], [750, 595], [960, 595], [1040, 595], [1120, 595], [655, 1010], [760, 1010], [655, 1150], [760, 1150], [655, 1320], [760, 1320],
    [670, 1560], [735, 1560], [670, 1680], [735, 1680], [460, 1830], [800, 1830], [960, 1615], [1290, 1615], [1490, 960], [1395, 960]].map(([x, y], i) => P('lamp_' + i, 'as_light', x, y, { solid: false })),
  ...[[770, 1085], [960, 1085], [540, 1525], [880, 1525], [1290, 935], [1360, 935]].map(([x, y], i) => P('bench_' + i, 'poke_c_bench', x, y)),
];

const lines = fs.readFileSync(path.join(OUT, NAME + '.pdsmap'), 'utf8').split(/\r?\n/);
const ts = path.join(OUT, TILESET);
const tiles = new Map();
const key = (p) => p.model + (p.rot ? '_r' + p.rot : '');
const want = [...new Map(placements.map((p) => [key(p), p])).entries()];
const list = [], info = {};
for (const [k, p] of want) {
  const glb = FOLDERS.map((f) => path.join(HUB, f, p.model, p.model + '.glb')).find((f) => fs.existsSync(f));
  if (!glb) throw new Error('no ripped model for ' + p.model);
  const dir = path.join(WORK, 'model-tiles-1to1', k);
  const r = convert(glb, dir, k, 1, 16, p.rot || 0); // native size, never rescaled
  info[k] = r; list.push([dir.split(path.sep).join('/'), k + '.obj', r.w, r.h].join('\t'));
}
fs.writeFileSync(path.join(OUT, 'import-list.txt'), list.join('\n') + '\n');
const imp = spawnSync(JAVA, ['-Djava.awt.headless=true', '-cp', CP, 'TileImport', ts, ts, path.join(OUT, 'import-list.txt')], { encoding: 'utf8', maxBuffer: 1 << 26 });
if (imp.status !== 0) throw new Error('TileImport failed\n' + imp.stderr);
const index = [];
for (const l of imp.stdout.split(/\r?\n/)) {
  const m = l.match(/^(\d+)\t([^\t]+)\.obj\t(\d+)x(\d+)$/); if (!m) continue;
  const r = info[m[2]]; tiles.set(m[2], { id: +m[1], w: r.w, h: r.h, bounds: r.bounds });
  index.push(`${m[1]}\t${m[2]}.obj\t${r.w}x${r.h}\t${r.bounds.map((v) => +v.toFixed(3)).join(',')}`);
}
fs.writeFileSync(path.join(OUT, 'model-tile-index.txt'), index.join('\n') + '\n');

const maps = new Map();
for (let i = 0; i < lines.length; i++) if (lines[i] === 'mapstart') {
  const k = lines[i + 1].trim(); const m = { tg: [], hg: [] }; maps.set(k, m);
  for (let j = i + 2; lines[j] !== 'mapend'; j++) { if (lines[j] === 'tilegrid') m.tg.push(j); if (lines[j] === 'heightgrid') m.hg.push(j); }
}
const getRow = (hdr, r) => lines[hdr + 1 + r].trim().split(/\s+/).map(Number);
const cell = (gx, gy, layer) => { const m = maps.get(`${Math.floor(gx / 32)} ${Math.floor(gy / 32)}`); return m && getRow(m.tg[layer], 31 - (gy % 32))[gx % 32]; };
const setCell = (gx, gy, layer, id, hh) => {
  const m = maps.get(`${Math.floor(gx / 32)} ${Math.floor(gy / 32)}`); if (!m) return false;
  const r = 31 - (gy % 32), x = gx % 32;
  const tr = getRow(m.tg[layer], r); if (tr[x] !== -1) return false; tr[x] = id; lines[m.tg[layer] + 1 + r] = tr.join(' ') + ' ';
  const hr = getRow(m.hg[layer], r); hr[x] = hh; lines[m.hg[layer] + 1 + r] = hr.join(' ') + ' ';
  return true;
};
const setGround = (gx, gy, id, hh) => { const m = maps.get(`${Math.floor(gx / 32)} ${Math.floor(gy / 32)}`); const r = 31 - (gy % 32), x = gx % 32;
  const tr = getRow(m.tg[0], r); tr[x] = id; lines[m.tg[0] + 1 + r] = tr.join(' ') + ' '; const hr = getRow(m.hg[0], r); hr[x] = hh; lines[m.hg[0] + 1 + r] = hr.join(' ') + ' '; };
const tj = JSON.parse(fs.readFileSync(path.join(OUT, 'tiles.json'), 'utf8'));

// moat water: flat cells at the moat level get water
let water = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (T[y][x] === MOAT && level[y][x] === MOAT && ground[y][x] === 'grass') {
  const flat = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(([a, b]) => tj.level[y + b]?.[x + a] === MOAT);
  if (flat && cell(x, y, 0) === 1157) { setGround(x, y, 1170, MOAT); water++; }
}

const solid = [], report = [];
for (const p of placements) {
  const k = key(p), t = tiles.get(k);
  const ax = Math.round(p.cx - t.w / 2), ay = Math.round(p.cy + t.h / 2 - 1);
  const lv = p.level ?? tj.level[Math.min(H - 1, Math.round(p.cy))][Math.min(W - 1, Math.round(p.cx))];
  let layer = p.layer; while (layer < 8 && !setCell(ax, ay, layer, t.id, lv)) layer++;
  if (layer >= 8) { report.push(`!! ${p.id}: no free layer at ${ax},${ay}`); continue; }
  const [minX, minY, maxX, maxY] = t.bounds, gx0 = ax + t.w / 2 - (maxX - minX) / 2, gy1 = ay + 1 - t.h / 2 + (maxY - minY) / 2;
  const r = [gx0, gy1 - (maxY - minY), gx0 + (maxX - minX), gy1];
  report.push(`${p.id.padEnd(15)} ${k.padEnd(15)} ${(maxX - minX).toFixed(1)}x${(maxY - minY).toFixed(1)} at ${ax},${ay} level ${lv}`);
  if (p.solid) solid.push(r);
}
fs.writeFileSync(path.join(OUT, NAME + '.pdsmap'), lines.join('\n'));

let blocked = 0;
for (const [mk] of maps) {
  const [mx, my] = mk.split(' ').map(Number), file = path.join(OUT, `${NAME}_${String(mx).padStart(2, '0')}_${String(my).padStart(2, '0')}.per`);
  const per = fs.readFileSync(file);
  for (let r = 0; r < 32; r++) for (let x = 0; x < 32; x++) {
    const cx = mx * 32 + x + 0.5, cy = my * 32 + r + 0.5, gx = mx * 32 + x, gy = my * 32 + r;
    if (T[gy][gx] === MOAT && level[gy][gx] === MOAT) { per[(r * 32 + x) * 2] = 0x15; per[(r * 32 + x) * 2 + 1] = 0x80; }
    if (solid.some(([w, n, e, s]) => cx > w + 0.3 && cx < e - 0.3 && cy > n + 0.3 && cy < s - 0.3)) { per[(r * 32 + x) * 2 + 1] = 0x80; blocked++; }
  }
  fs.writeFileSync(file, per);
}
console.log(report.join('\n'));
console.log(`${placements.length} models, ${trees.length} trees, ${stairs.length} stair flights, ${water} moat water cells, ${blocked} cells blocked under buildings`);
