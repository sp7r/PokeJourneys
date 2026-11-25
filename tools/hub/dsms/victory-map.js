// Builds Victory Island as a DS Map Studio project from a layout of ground types and levels.
// The layout is sampled on a corner lattice (one point per tile corner). Flat cells get Platinum ground tiles
// chosen by their four corner ground types; cells whose corners differ by one level get Platinum cliff tiles
// chosen by which corners are high; stairs replace straight cliff runs. Tile choices come from measured
// tile colours (TileSig) and tile heights (TileZ).
// The layout is either shapes (victory-layout.json) or a per-tile grid of ground and level from minecraft-layout.js;
// with a grid, stairs are placed automatically wherever paving crosses a one-level cliff.
// Grid layouts also get plank decks (boardwalk, piers, bridges) on layer 2 and, optionally, paved aprons around
// buildings (aprons.json from victory-world.js: [{x0, z0, x1, z1, level}] in map tiles, inclusive).
// Usage: node victory-map.js <layout.json> <outDir> <tile-sig.json> <tile-z.json> [aprons.json]
const fs = require('fs');
const path = require('path');

const [LAYOUT, OUT, SIGFILE, ZFILE, APRONS] = process.argv.slice(2);
const layout = JSON.parse(fs.readFileSync(LAYOUT, 'utf8'));
const SIG = JSON.parse(fs.readFileSync(SIGFILE, 'utf8'));
const TZ = JSON.parse(fs.readFileSync(ZFILE, 'utf8'));
const GRID = Array.isArray(layout.ground);
const NAME = layout.name || 'VictoryIsland', TILESET = 'JourneysHub.pdsts';
const [MX, MY] = GRID ? [Math.ceil(layout.width / 32), Math.ceil(layout.height / 32)] : layout.maps, W = MX * 32, H = MY * 32;
// grid offset inside the maps (tiles), centred
const OX = GRID ? Math.floor((W - layout.width) / 2) : 0, OZ = GRID ? Math.floor((H - layout.height) / 2) : 0;
// Water boxed in above the boardwalk (between the shore and a pier) becomes land down to its top edge, so the boardwalk
// always meets land: walking north from the deck, a sea cell fills while land lies within 6 cells to its west and land
// or deck within 6 to its east (or the other way round).
if (GRID) {
  const deckAt = new Set((layout.decks || []).flatMap((d) => d.cellsList.map(([x, z]) => x + ',' + z)));
  const g = (x, z) => layout.ground[z]?.[x];
  const solid = (x, z) => deckAt.has(x + ',' + z) || (g(x, z) && g(x, z) !== 'sea');
  const isLand = (x, z) => !deckAt.has(x + ',' + z) && g(x, z) && g(x, z) !== 'sea';
  const near = (x, z, dx, test) => { for (let k = 1; k <= 6; k++) if (test(x + dx * k, z)) return x + dx * k; return null; };
  let filled = 0;
  const boardwalk = [...(layout.decks || [])].sort((p, q) => q.cellsList.length - p.cellsList.length)[0]; // bridges keep their water
  for (const d of boardwalk ? [boardwalk] : []) for (const [x, z0] of d.cellsList) {
    for (let z = z0 - 1; z >= 0 && g(x, z) === 'sea' && !deckAt.has(x + ',' + z); z--) {
      const wl = near(x, z, -1, isLand), el = near(x, z, 1, isLand);
      const land = wl !== null && near(x, z, 1, solid) !== null ? wl : el !== null && near(x, z, -1, solid) !== null ? el : null;
      if (land === null) break;
      layout.ground[z][x] = g(land, z); layout.level[z][x] = layout.level[z][land]; filled++;
    }
  }
  if (filled) console.log('land filled above decks', filled);
}

// ---- ground types ----
const SEA = 0, BEACH = 1, GRASS = 2, PAVE = 3, PATH = 4, BRICK = 5;
const NAMES = ['sea', 'beach', 'grass', 'pave', 'path', 'brick'];
const BY_NAME = { sea: SEA, beach: BEACH, grass: GRASS, pave: PAVE, path: PATH, brick: BRICK, flowers: GRASS };
const RANK = [0, 1, 2, 3, 3, 4];
const DOWN = [SEA, SEA, BEACH, GRASS, GRASS, PAVE];
const FILL = { [SEA]: [1170], [BEACH]: [1181], [GRASS]: [1157], [PAVE]: [1167], [PATH]: [1166], [BRICK]: [1165] };
const FAMILIES = [
  { a: BEACH, b: SEA, tiles: [1054, 1055, 1056, 1057, 1058, 1059, 1060, 1061, 1120, 1121, 1128, 1129] },
  { a: BEACH, b: GRASS, tiles: [1094, 1095, 1096, 1097, 1098, 1099, 1100, 1101, 1140, 1141, 1148, 1149] },
  { a: PAVE, b: GRASS, tiles: [1062, 1063, 1064, 1065, 1066, 1067, 1068, 1069, 1122, 1123, 1130, 1131] },
  { a: PATH, b: GRASS, tiles: [886, 887, 888, 889, 890, 891, 892, 893, 1134, 1135, 1142, 1143] },
  { a: BRICK, b: PAVE, tiles: [1046, 1047, 1048, 1049, 1050, 1051, 1052, 1053, 1118, 1119, 1126, 1127] },
];
const FLOWERS = [1171, 1172, 1173];
// Cliffs (HeartGold light brown rock): sides, one-high corners, three-high corners.
const CLIFF_SIDES = [454, 455, 456, 457];
const CLIFF_ONE = { [GRASS]: [458, 459, 460, 461], [BEACH]: [458, 459, 460, 461] };
const CLIFF_THREE = [686, 687, 688, 689];
const STAIRS = { N: 1238, S: 1239, E: 1240, W: 1241 };
const STAIRS2 = { N: 1236, S: 1237, E: 1234, W: 1235 }; // two wide
// fences (Black 2): wood for Minecraft fences, white rails for stone walls; pieces by the sides they connect
const FENCES = { fence: { EW: 382, NS: 385, ES: 381, SW: 383, EN: 384, NW: 386, X: 387 }, wall: { EW: 390, NS: 393, ES: 389, SW: 391, EN: 392, NW: 394, X: 395 } };

const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const mean = (cs) => [0, 1, 2].map((k) => cs.reduce((s, c) => s + c[k], 0) / cs.length);
for (const f of FAMILIES) { // corner ground types of each edge tile (NW, NE, SW, SE = regions 0, 2, 6, 8)
  let ca = mean(FILL[f.a].map((i) => SIG[i].r[4])), cb = mean(FILL[f.b].map((i) => SIG[i].r[4]));
  const pts = f.tiles.flatMap((i) => [0, 2, 6, 8].map((k) => SIG[i].r[k]));
  for (let it = 0; it < 10; it++) {
    const A = pts.filter((p) => dist(p, ca) <= dist(p, cb)), B = pts.filter((p) => dist(p, ca) > dist(p, cb));
    if (A.length) ca = mean(A); if (B.length) cb = mean(B);
  }
  f.byKey = {};
  for (const i of f.tiles) {
    const key = [0, 2, 6, 8].map((k) => (dist(SIG[i].r[k], ca) <= dist(SIG[i].r[k], cb) ? f.a : f.b)).join(',');
    (f.byKey[key] = f.byKey[key] || []).push(i);
  }
  f.byKey[[f.a, f.a, f.a, f.a].join(',')] = FILL[f.a];
  f.byKey[[f.b, f.b, f.b, f.b].join(',')] = FILL[f.b];
}
const highKey = (i) => TZ[i].z[0].slice(0, 4).map((z) => (z > 0.6 ? 1 : 0)).join('');
const cliffByKey = {};
for (const i of [...CLIFF_SIDES, ...CLIFF_THREE]) cliffByKey[highKey(i)] = { any: i };
for (const [g, list] of Object.entries(CLIFF_ONE)) for (const i of list) (cliffByKey[highKey(i)] = cliffByKey[highKey(i)] || {})[g] = i;

// ---- sample the layout on the corner lattice ----
function inPoly(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const inside = (s, x, y) => s.poly ? inPoly(s.poly, x, y)
  : s.rect ? x >= s.rect[0] && x <= s.rect[2] && y >= s.rect[1] && y <= s.rect[3]
  : s.circle ? Math.hypot(x - s.circle[0], y - s.circle[1]) <= s.circle[2] : false;
const T = [], L = [], FL = [], TRK = []; // ground type, level, flower flag, Pokeathlon track flag per lattice point [y][x]
// Pokeathlon track overlay tiles (track_NWNESWSE in model-tile-index.txt, from dsms.sh pokeathlon): paving on the
// stadium island level becomes orange track with white rims; without the tiles it stays paving
const TRACK_LEVEL = 3;
const MODEL_INDEX = fs.existsSync(path.join(OUT, 'model-tile-index.txt')) ? Object.fromEntries(fs.readFileSync(path.join(OUT, 'model-tile-index.txt'), 'utf8')
  .split(/\r?\n/).map((l) => l.split(/\t/)).filter((p) => p[2]).map(([id, obj]) => [obj.replace(/\.obj$/, ''), +id])) : {};
const HAS_TRACK = MODEL_INDEX.track_1111 !== undefined;
const isTrack = (x, z) => { const gx = x - OX, gz = z - OZ;
  return HAS_TRACK && (layout.ground[gz]?.[gx] === 'track' || (layout.ground[gz]?.[gx] === 'pave' && layout.level[gz][gx] === TRACK_LEVEL)); }; // 'track' ground: on any level
if (GRID) {
  // a lattice point takes the highest level of the four tiles around it (cliffs fall on the lower side), and the most
  // common ground among those highest tiles; on ties grass wins over paving, so a path three tiles wide is drawn
  // about two tiles wide once its edge tiles are counted
  const cell = (x, z) => {
    const gx = x - OX, gz = z - OZ;
    if (gx < 0 || gz < 0 || gx >= layout.width || gz >= layout.height) return { t: SEA, l: 0 };
    const g = layout.ground[gz][gx];
    // paving on the stadium island is Pokeathlon track: grass underneath, the track drawn over it (below)
    if (isTrack(x, z)) return { t: GRASS, l: layout.level[gz][gx], f: false, track: true };
    return { t: BY_NAME[g] ?? GRASS, l: g === 'sea' ? 0 : layout.level[gz][gx], f: g === 'flowers' };
  };
  for (let y = 0; y <= H; y++) {
    T.push([]); L.push([]); FL.push([]); TRK.push([]);
    for (let x = 0; x <= W; x++) {
      const around = [cell(x - 1, y - 1), cell(x, y - 1), cell(x - 1, y), cell(x, y)];
      const l = Math.max(...around.map((c) => c.l)), top = around.filter((c) => c.l === l);
      const count = {}; top.forEach((c) => (count[c.t] = (count[c.t] || 0) + 1));
      // ties: grass beats paving (paths draw narrower), brick beats paving (plaza patterns keep their size)
      const PREF = { [GRASS]: 5, [BRICK]: 4, [PAVE]: 3, [PATH]: 3, [BEACH]: 2, [SEA]: 1 };
      const t = +Object.entries(count).sort((p, q) => q[1] - p[1] || PREF[q[0]] - PREF[p[0]])[0][0];
      T[y].push(t); L[y].push(l); FL[y].push(around.every((c) => c.f));
      // a corner is track when at least half the tiles around it are, so a path three tiles wide stays three wide
      TRK[y].push(around.filter((c) => c.track).length >= 2 && around.every((c) => c.l === l));
    }
  }
  // paved aprons around buildings, on the building's own level
  if (APRONS && fs.existsSync(APRONS)) for (const a of JSON.parse(fs.readFileSync(APRONS, 'utf8')))
    for (let y = a.z0; y <= a.z1 + 1; y++) for (let x = a.x0; x <= a.x1 + 1; x++)
      if (y >= 0 && x >= 0 && y <= H && x <= W && L[y][x] === a.level && T[y][x] === GRASS) T[y][x] = PAVE; // grass only: plaza patterns stay
} else for (let y = 0; y <= H; y++) {
  T.push([]); L.push([]); FL.push([]);
  for (let x = 0; x <= W; x++) {
    let t = SEA, l = 0, fl = false;
    for (const s of layout.shapes) if (inside(s, x, y)) {
      if (s.terrain) { t = BY_NAME[s.terrain]; fl = s.terrain === 'flowers'; }
      if (s.level !== undefined) l = s.level;
    }
    T[y].push(t); L[y].push(l); FL[y].push(fl);
  }
}
// Grid layouts carry stair flights ({dir, cells, lo, hi}); each becomes one stair row per level, carved into the lattice
// as straight one-level steps that the repair below leaves alone.
const locked = new Set();
if (GRID) {
  const flights = layout.stairs || [];
  layout.stairs = [];
  for (const f of flights) {
    if (f.lo === null || f.hi === null || f.hi <= f.lo) continue;
    const cells = f.cells.map(([x, z]) => [x + OX, z + OZ]);
    const along = ([x, z]) => ({ N: -z, S: z, E: x, W: -x })[f.dir];
    const acrossOf = ([x, z]) => (f.dir === 'N' || f.dir === 'S' ? x : z);
    const aLow = Math.min(...cells.map(along));
    const across = [...new Set(cells.map(acrossOf))].sort((p, q) => p - q), c0 = across[0], c1 = across[across.length - 1];
    const width = c1 - c0 + 1;
    // cell at "along" position a and across position c, in map coordinates
    const cellAt = (a, c) => ({ N: [c, -a], S: [c, a], E: [a, c], W: [-a, c] })[f.dir];
    const setEdge = (a, front, value) => { // front or back vertex line of the cells at along position a
      const [x, z] = cellAt(a, c0);
      for (let c = c0; c <= c1 + 1; c++) {
        let vx, vz;
        if (f.dir === 'N') { vx = c; vz = front ? z + 1 : z; } else if (f.dir === 'S') { vx = c; vz = front ? z : z + 1; }
        else if (f.dir === 'E') { vx = front ? x : x + 1; vz = c; } else { vx = front ? x + 1 : x; vz = c; }
        if (vx < 0 || vz < 0 || vx > W || vz > H) continue;
        L[vz][vx] = value; if (RANK[T[vz][vx]] < 3 && T[vz][vx] !== SEA) T[vz][vx] = PAVE; if (T[vz][vx] === SEA) T[vz][vx] = PAVE;
        locked.add(vx + ',' + vz);
      }
    };
    const n = f.hi - f.lo;
    setEdge(aLow - 1, true, f.lo); // flat landing in front
    for (let i = 0; i < n; i++) {
      setEdge(aLow + i, true, f.lo + i); setEdge(aLow + i, false, f.lo + i + 1);
      const [x, z] = cellAt(aLow + i, f.dir === 'E' || f.dir === 'W' ? c0 : c0);
      // stairs entries: wide flights (N/S) start at their west cell, narrow ones (E/W) at their north cell
      layout.stairs.push({ x, y: z, dir: f.dir, width, level: f.lo + i });
    }
    setEdge(aLow + n, false, f.hi); // flat landing behind
  }
}
const T0 = T.map((r) => r.slice()); // ground types as laid out, before cliff repair adds sand rims
// levels as laid out: the repair never lifts a point above this, so one fix can't ripple a raised rim along a coast
const L0 = L.map((r) => r.slice());
const corners = (x, y) => [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
// stairs footprints (cells), so their corners keep their ground type
const stairCells = new Map();
for (const s of layout.stairs || []) {
  const wide = s.dir === 'N' || s.dir === 'S';
  for (let k = 0; k < (s.width || 3); k++) stairCells.set(`${s.x + (wide ? k : 0)},${s.y + (wide ? 0 : k)}`, s);
}

// ---- repair: two levels per cell at most (a drop of several levels becomes a stacked cliff), no diagonal splits,
// cliffs have grass on top and grass or sand below; carved stair vertices stay as they are ----
for (let pass = 0; pass < 60; pass++) {
  let changed = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = corners(x, y), lv = c.map(([a, b]) => L[b][a]);
    const lo = Math.min(...lv), hi = Math.max(...lv);
    if (new Set(lv).size > 2) {
      let moved = 0;
      c.forEach(([a, b], k) => { if (lv[k] !== lo && lv[k] !== hi && !locked.has(a + ',' + b)) { L[b][a] = hi - lv[k] <= lv[k] - lo && hi <= L0[b][a] ? hi : lo; moved++; } });
      // the middle height is a carved stair corner: each free corner takes the carved height nearest its own, so a
      // two-level flight never spreads its top level around the island
      if (!moved) { const carved = c.filter(([a, b]) => locked.has(a + ',' + b)).map(([a, b]) => L[b][a]);
        c.forEach(([a, b]) => { if (locked.has(a + ',' + b)) return;
          const near = carved.reduce((p, q) => (Math.abs(q - L[b][a]) < Math.abs(p - L[b][a]) || (Math.abs(q - L[b][a]) === Math.abs(p - L[b][a]) && q > p) ? q : p));
          if (L[b][a] !== near) { L[b][a] = near; moved++; } }); }
      changed += moved; continue; }
    if (hi !== lo && lv[0] === lv[3] && lv[1] === lv[2]) { // diagonal split: raise the low corners, or lower the high ones when the low ones are carved
      let moved = 0;
      c.forEach(([a, b], k) => { if (lv[k] === lo && !locked.has(a + ',' + b) && hi <= L0[b][a]) { L[b][a] = hi; moved++; } });
      if (!moved) c.forEach(([a, b], k) => { if (lv[k] === hi && !locked.has(a + ',' + b)) { L[b][a] = lo; moved++; } });
      changed += moved; continue; }
    if (hi === lo || stairCells.has(`${x},${y}`)) continue;
    c.forEach(([a, b], k) => {
      const t = T[b][a];
      const want = lv[k] === hi ? GRASS : t === BEACH || t === SEA ? BEACH : GRASS;
      if (t !== want) { T[b][a] = want; FL[b][a] = false; changed++; }
    });
  }
  // flat cells: at most two ground types, a pair that has an edge family, no diagonal split
  const pairOk = (a, b) => a === b || FAMILIES.some((f) => (f.a === a && f.b === b) || (f.a === b && f.b === a));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = corners(x, y), lv = c.map(([a, b]) => L[b][a]);
    if (Math.min(...lv) !== Math.max(...lv)) continue;
    const t = c.map(([a, b]) => T[b][a]), set = [...new Set(t)];
    let bad = set.length > 2 || (set.length === 2 && !pairOk(set[0], set[1]));
    if (!bad && set.length === 2 && t[0] === t[3] && t[1] === t[2] && t[0] !== t[1]) bad = true;
    if (!bad) continue;
    const top = Math.max(...t.map((v) => RANK[v]));
    c.forEach(([a, b], k) => { if (RANK[t[k]] === top) { T[b][a] = DOWN[t[k]]; changed++; } });
  }
  // land is never below sea: any non-sea point at level 0 next to the sea is beach, any sea point above 0 is land
  for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) if (T[y][x] === SEA && L[y][x] > 0) { T[y][x] = BEACH; changed++; }
  if (!changed) break;
}

// ---- plank decks (grid layouts): boardwalk, piers and bridges on layer 2 ----
// Light Black 2 boards: 370 (1x3) side by side make an east-west deck three wide, 368 (3x1) a north-south one;
// 369 / 358 for two wide, 1245 / 1249 single boards. A bridge between two levels gets a stair tile across its middle.
const PLANK = { x: { 3: 370, 2: 369, 1: 1245 }, z: { 3: 368, 2: 358, 1: 1249 } };
const BRIDGE_STAIRS = { 3: { N: 1238, S: 1239, E: 1240, W: 1241 }, 2: { N: 1236, S: 1237, E: 1234, W: 1235 } };
const deckLevel = new Map(), deckTiles = [];
if (GRID) for (const d of layout.decks || []) {
  const alongX = d.axis === 'x';
  const cells = new Set(d.cellsList.map(([x, z]) => x + ',' + z));
  const rect = cells.size === (d.x1 - d.x0) * (d.z1 - d.z0);
  const [lo0, hi0] = alongX ? [d.x0, d.x1 - 1] : [d.z0, d.z1 - 1], across = alongX ? [d.z0, d.z1] : [d.x0, d.x1];
  let a0 = Math.min(d.ends[0].at, lo0), a1 = Math.max(d.ends[1].at, hi0);
  // cliff rings take a tile or two off island edges: carry each end on until the ground under it is flat at that end's level
  const stopAt = (a) => { const midB = Math.floor((across[0] + across[1]) / 2), [x, z] = alongX ? [a + OX, midB + OZ] : [midB + OX, a + OZ];
    if (x < 0 || z < 0 || x >= W || z >= H) return true;
    return stairCells.has(x + ',' + z) || new Set(corners(x, z).map(([p, q]) => L[q][p])).size === 1; };
  if (rect) {
    for (let k = 0; k < 4 && !stopAt(a0 - 1) && !stopAt(a0); k++) a0--;
    for (let k = 0; k < 4 && !stopAt(a1 + 1) && !stopAt(a1); k++) a1++;
  }
  // straight bridges reach over the cliff rings to where the path continues
  if (rect) for (let a = a0; a <= a1; a++) for (let b = across[0]; b < across[1]; b++) cells.add(alongX ? a + ',' + b : b + ',' + a);
  const hiEnd = d.ends[0].level > d.ends[1].level ? 0 : 1, lvLo = Math.min(d.ends[0].level, d.ends[1].level), lvHi = Math.max(d.ends[0].level, d.ends[1].level);
  const mid = Math.floor((a0 + a1) / 2), width = across[1] - across[0];
  const stairsHere = d.ramp && rect && BRIDGE_STAIRS[width];
  const levelAt = (a) => !d.ramp ? d.ends[0].level : a === mid ? lvLo : (hiEnd === 0 ? a < mid : a > mid) ? lvHi : lvLo;
  for (const k of [...cells]) { const [x, z] = k.split(',').map(Number); if (stairCells.has((x + OX) + ',' + (z + OZ))) { cells.delete(k); continue; } deckLevel.set((x + OX) + ',' + (z + OZ), levelAt(alongX ? x : z)); }
  if (stairsHere) {
    const dir = alongX ? (hiEnd === 0 ? 'W' : 'E') : (hiEnd === 0 ? 'N' : 'S');
    const run = [...Array(width)].map((_, i) => alongX ? [mid, across[0] + i] : [across[0] + i, mid]);
    // the tile sits on its south-west cell
    const [ox, oz] = alongX ? [mid, across[1] - 1] : [across[0], mid];
    deckTiles.push({ x: ox + OX, y: oz + OZ, id: BRIDGE_STAIRS[width][dir], level: lvLo, stairs: dir, cells: run.map(([a, b]) => [a + OX, b + OZ]) });
  }
  // boards across the deck's direction, in runs of up to three, laid from the south (east) edge so that edge stays
  // straight and any short boards end up along the ragged inland side
  const left = new Set([...cells].filter((k) => !(stairsHere && Number(k.split(',')[alongX ? 0 : 1]) === mid)));
  const sorted = [...left].map((k) => k.split(',').map(Number)).sort((p, q) => q[1] - p[1] || q[0] - p[0]);
  for (const [x, z] of sorted) {
    if (!left.has(x + ',' + z)) continue;
    let n = 1;
    while (n < 3 && left.has(alongX ? x + ',' + (z - n) : (x - n) + ',' + z)) n++;
    const run = [...Array(n)].map((_, i) => alongX ? [x, z - i] : [x - i, z]);
    run.forEach(([a, b]) => left.delete(a + ',' + b));
    deckTiles.push({ x: (alongX ? x : x - n + 1) + OX, y: z + OZ, id: PLANK[d.axis][n], level: levelAt(alongX ? x : z), cells: run.map(([a, b]) => [a + OX, b + OZ]) });
  }
}

// ---- automatic stairs (grid layouts): paving on both sides of a straight one-level cliff ----
if (GRID && !layout.stairs) {
  layout.stairs = [];
  const used = new Set(), beachFlights = [];
  const keyAt = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return null;
    const lv = corners(x, y).map(([a, b]) => L[b][a]), hi = Math.max(...lv), lo = Math.min(...lv);
    return hi === lo ? null : lv.map((v) => (v === hi ? 1 : 0)).join(''); };
  const paved = (x, y) => x >= 0 && y >= 0 && x <= W && y <= H && RANK[T[y][x]] >= 3;
  const DIRS = { '1100': ['N', 1, 0], '0011': ['S', 1, 0], '0101': ['E', 0, 1], '1010': ['W', 0, 1] };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const key = keyAt(x, y), d = DIRS[key];
    if (!d || used.has(`${x},${y}`)) continue;
    const [dir, sx, sy] = d;
    // paving just beyond the top and the foot of this cliff cell
    const up = dir === 'N' ? [[x, y - 1], [x + 1, y - 1]] : dir === 'S' ? [[x, y + 2], [x + 1, y + 2]] : dir === 'E' ? [[x + 2, y], [x + 2, y + 1]] : [[x - 1, y], [x - 1, y + 1]];
    const down = dir === 'N' ? [[x, y + 2], [x + 1, y + 2]] : dir === 'S' ? [[x, y - 1], [x + 1, y - 1]] : dir === 'E' ? [[x - 1, y], [x - 1, y + 1]] : [[x + 2, y], [x + 2, y + 1]];
    const sandy = (x, y) => x >= 0 && y >= 0 && x <= W && y <= H && T0[y][x] === BEACH && T[y][x] === BEACH;
    // stairs where paving meets a cliff with paving below; down onto real beach they may also start on grass (two flights at most)
    const toSand = down.some(([a, b]) => sandy(a, b)) && !down.some(([a, b]) => paved(a, b));
    const grassy = (x, y) => x >= 0 && y >= 0 && x <= W && y <= H && T[y][x] === GRASS;
    if (toSand ? !up.some(([a, b]) => paved(a, b) || grassy(a, b)) : (!up.some(([a, b]) => paved(a, b)) || !down.some(([a, b]) => paved(a, b)))) continue;
    if (toSand && (beachFlights.length >= 2 || beachFlights.some(([p, q]) => Math.hypot(p - x, q - y) < 10))) continue;
    // a flight of three: centred here when the neighbours along the cliff match
    for (const start of [-1, 0, -2]) {
      const cells = [0, 1, 2].map((k) => [x + sx * (start + k), y + sy * (start + k)]);
      const nearDeck = cells.some(([a, b]) => [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0], [0, 2], [2, 0]].some(([p, q]) => deckLevel.has((a + p) + ',' + (b + q))));
      if (!nearDeck && cells.every(([a, b]) => keyAt(a, b) === key && !used.has(`${a},${b}`))) {
        if (toSand) beachFlights.push([x, y]);
        cells.forEach(([a, b]) => used.add(`${a},${b}`));
        // skip the rest of this run of paved cliff cells
        for (let k = 1; k < 6; k++) used.add(`${x + sx * k},${y + sy * k}`);
        layout.stairs.push({ x: cells[0][0], y: cells[0][1], dir });
        break;
      }
    }
  }
  // let the paving run onto the top and foot of each flight (the cliff repair turned those corners to grass)
  for (const s of layout.stairs) {
    const wide = s.dir === 'N' || s.dir === 'S';
    for (let k = 0; k <= 3; k++) for (const [a, b, fa, fb] of wide
      ? [[s.x + k, s.y, s.x + k, s.y - 1], [s.x + k, s.y + 1, s.x + k, s.y + 2]]
      : [[s.x, s.y + k, s.x - 1, s.y + k], [s.x + 1, s.y + k, s.x + 2, s.y + k]])
      if (fa >= 0 && fb >= 0 && fa <= W && fb <= H && RANK[T[fb][fa]] >= 3) T[b][a] = PAVE;
  }
  console.log('stairs', JSON.stringify(layout.stairs));
}
// ---- choose tiles ----
const grid = [], level = [], walk = [], behaviour = [], problems = [];
const stacked = []; // extra cliff copies for drops of several levels: { x, y, id, level, layer }
for (let y = 0; y < H; y++) {
  grid.push([]); level.push([]); walk.push([]); behaviour.push([]);
  for (let x = 0; x < W; x++) {
    const c = corners(x, y), lv = c.map(([a, b]) => L[b][a]), t = c.map(([a, b]) => T[b][a]);
    const lo = Math.min(...lv), hi = Math.max(...lv);
    let tile, ok = true, beh = 0;
    if (hi !== lo) {
      const key = lv.map((v) => (v === hi ? 1 : 0)).join('');
      const low = t.filter((v, k) => lv[k] === lo);
      const foot = low.filter((v) => v === BEACH).length * 2 > low.length ? BEACH : GRASS;
      // a leftover diagonal split (beside carved stairs) uses the nearest three-corner piece
      const opts = cliffByKey[key] || cliffByKey[{ '1001': '1101', '0110': '0111' }[key]];
      tile = opts ? (opts.any ?? opts[foot] ?? opts[GRASS]) : (problems.push(`cliff ${key} at ${x},${y}`), CLIFF_SIDES[0]);
      ok = false;
      if (foot === BEACH) beh = 0x21;
      // a drop of several levels: the same cliff piece again on top, one level higher each, on the top layers
      for (let k = 1; k < hi - lo; k++) stacked.push({ x, y, id: tile, level: lo + k, layer: 8 - k });
    } else {
      const set = [...new Set(t)];
      if (set.length === 1) {
        tile = FILL[set[0]][0];
        if (set[0] === GRASS && c.every(([a, b]) => FL[b][a])) tile = FLOWERS[(x * 7 + y * 3) % FLOWERS.length];
      } else {
        const f = FAMILIES.find((f) => set.every((v) => v === f.a || v === f.b));
        tile = f && f.byKey[t.join(',')] ? f.byKey[t.join(',')][0] : (problems.push(`ground ${t.map((v) => NAMES[v]).join('/')} at ${x},${y}`), FILL[GRASS][0]);
      }
      const counts = {}; t.forEach((v) => (counts[v] = (counts[v] || 0) + 1));
      const main = +Object.entries(counts).sort((p, q) => q[1] - p[1] || RANK[p[0]] - RANK[q[0]])[0][0];
      if (main === SEA) { ok = false; beh = 0x15; } else if (main === BEACH) beh = 0x21;
      // the sand strip the cliff repair adds along the waterline is scenery: only laid-out ground is walkable
      if (GRID && c.every(([a, b]) => T0[b][a] === SEA)) ok = false;
    }
    if (deckLevel.has(x + ',' + y)) { ok = true; beh = 0x73; } // walkable plank deck (bridge over water)
    grid[y].push(tile); level[y].push(lo); walk[y].push(ok); behaviour[y].push(beh);
  }
}
// stairs: replace three straight cliff cells; the tile sits on its south-west cell, the others stay empty
const multi = new Map(); // "x,y" of covered cells -> -1, origin -> id
for (const s of layout.stairs || []) {
  const wide = s.dir === 'N' || s.dir === 'S', want = { N: '1100', S: '0011', E: '0101', W: '1010' }[s.dir];
  const width = s.width || 3;
  const cells = [...Array(width)].map((_, k) => [s.x + (wide ? k : 0), s.y + (wide ? 0 : k)]);
  for (const [x, y] of cells) {
    const lv = corners(x, y).map(([a, b]) => L[b][a]), hi = Math.max(...lv);
    const key = lv.map((v) => (v === hi ? 1 : 0)).join('');
    if (key !== want) problems.push(`stairs ${s.dir} at ${s.x},${s.y}: cell ${x},${y} is ${key}, expected ${want}`);
    walk[y][x] = true; multi.set(`${x},${y}`, -1);
  }
  const [ox, oy] = cells[cells.length - 1][1] > cells[0][1] ? cells[cells.length - 1] : cells[0];
  multi.set(`${wide ? s.x : ox},${wide ? s.y : oy}`, width === 2 ? STAIRS2[s.dir] : STAIRS[s.dir]);
}
for (const [k, id] of multi) { const [x, y] = k.split(',').map(Number); grid[y][x] = id; }

// ---- write .pdsmap and .per (tile rows bottom-up inside a map, .per rows north-first) ----
fs.mkdirSync(OUT, { recursive: true });
const row = (n, f) => Array.from({ length: n }, (_, k) => f(k));
const deckGrid = Array.from({ length: H }, () => Array(W).fill(-1)), deckH = Array.from({ length: H }, () => Array(W).fill(0));
for (const t of deckTiles) if (t.x >= 0 && t.y >= 0 && t.x < W && t.y < H) { deckGrid[t.y][t.x] = t.id; deckH[t.y][t.x] = t.level; }
const extra = Array.from({ length: 8 }, () => Array.from({ length: H }, () => Array(W).fill(null)));
for (const s of stacked) extra[s.layer - 1][s.y][s.x] = [s.id, s.level];
// Pokeathlon track on layer 4, one overlay piece per flat tile by which of its corners are track
if (GRID && HAS_TRACK) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const c = corners(x, y), lv = c.map(([a, b]) => L[b][a]);
  if (Math.min(...lv) !== Math.max(...lv)) continue;
  const key = c.map(([a, b]) => (TRK[b][a] ? 1 : 0)).join('');
  if (key !== '0000') extra[3][y][x] = [MODEL_INDEX['track_' + key], level[y][x]];
}
if (GRID) { // walls and fences: the piece follows the neighbours of the same kind
  const kinds = new Map((layout.fences || []).map(([x, z, t, l]) => [(x + OX) + ',' + (z + OZ), [t, l]]));
  for (const [k, [t, l]] of kinds) {
    const [x, y] = k.split(',').map(Number); if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const same = (a, b) => kinds.get(a + ',' + b)?.[0] === t;
    const n = same(x, y - 1), s = same(x, y + 1), e = same(x + 1, y), w = same(x - 1, y), count = n + s + e + w;
    const key = count >= 3 ? 'X' : n && s ? 'NS' : e && w ? 'EW' : e && s ? 'ES' : s && w ? 'SW' : e && n ? 'EN' : n && w ? 'NW' : n || s ? 'NS' : 'EW';
    extra[2][y][x] = [FENCES[t][key], l];
    walk[y][x] = false;
  }
}
if (GRID) { // trees given as map tiles ({x0, z0, tile}, e.g. the 2x2 Platinum trees 879/881) stand on layer 6 and block
  for (const t of layout.trees || []) {
    if (t.tile === undefined) continue; // older layouts list tree spots for the hub's own tree sprites
    const [w, h] = [TZ[t.tile]?.w || 1, TZ[t.tile]?.h || 1], x = t.x0 + OX, y = t.z0 + OZ + h - 1; // tiles grow north from their anchor
    if (x < 0 || y < 0 || x + w > W || y >= H) continue;
    extra[5][y][x] = [t.tile, level[y][x]];
    for (let dz = 0; dz < h; dz++) for (let dx = 0; dx < w; dx++) walk[y - dz][x + dx] = false;
  }
}
let txt = `gameindex\n2\ntileset\n${TILESET}\n`;
for (let my = 0; my < MY; my++) for (let mx = 0; mx < MX; mx++) {
  txt += `mapstart\n${mx} ${my}\nareaindex\n0\n`;
  for (let l = 0; l < 8; l++) { txt += 'tilegrid\n'; for (let r = 0; r < 32; r++) txt += row(32, (x) => (l === 0 ? grid[my * 32 + 31 - r][mx * 32 + x] : l === 1 ? deckGrid[my * 32 + 31 - r][mx * 32 + x] : extra[l][my * 32 + 31 - r][mx * 32 + x]?.[0] ?? -1)).join(' ') + ' \n'; }
  for (let l = 0; l < 8; l++) { txt += 'heightgrid\n'; for (let r = 0; r < 32; r++) txt += row(32, (x) => (l === 0 ? level[my * 32 + 31 - r][mx * 32 + x] : l === 1 ? deckH[my * 32 + 31 - r][mx * 32 + x] : extra[l][my * 32 + 31 - r][mx * 32 + x]?.[1] ?? 0)).join(' ') + ' \n'; }
  txt += 'mapend\n';
  const per = Buffer.alloc(2048);
  for (let r = 0; r < 32; r++) for (let x = 0; x < 32; x++) {
    const gy = my * 32 + r, gx = mx * 32 + x, k = (r * 32 + x) * 2;
    per[k] = behaviour[gy][gx]; per[k + 1] = walk[gy][gx] ? 0 : 0x80;
  }
  fs.writeFileSync(path.join(OUT, `${NAME}_${String(mx).padStart(2, '0')}_${String(my).padStart(2, '0')}.per`), per);
}
fs.writeFileSync(path.join(OUT, `${NAME}.pdsmap`), txt);
// per-tile summary for placing buildings and decks in the hub: level, walkable, and where the source grid sits
fs.writeFileSync(path.join(OUT, 'tiles.json'), JSON.stringify({ width: W, height: H, offset: [OX, OZ], level, walk, stairs: layout.stairs || [],
  decks: [...deckLevel].map(([k, v]) => [...k.split(',').map(Number), v]),
  bridgeStairs: deckTiles.filter((t) => t.stairs).map((t) => ({ cells: t.cells, dir: t.stairs, level: t.level })) }));
// quick text view: ground letter per cell, upper case on raised levels, '#' cliffs, '=' stairs
const letters = 'sbgpyr';
const view = grid.map((r, y) => r.map((id, x) => {
  if (multi.has(`${x},${y}`)) return '=';
  const lv = corners(x, y).map(([a, b]) => L[b][a]);
  if (Math.min(...lv) !== Math.max(...lv)) return '#';
  const ch = letters[T[y][x]];
  return level[y][x] >= 2 ? ch.toUpperCase() : level[y][x] === 1 ? ch : ch === 's' ? '~' : '.';
}).join('')).join('\n');
fs.writeFileSync(path.join(OUT, 'layout.txt'), view + '\n');
console.log(view);
console.log(problems.length ? 'problems:\n' + problems.join('\n') : 'no problems');
