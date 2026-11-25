// Rebuilds hub/game/config/world.json for Victory Island from the Minecraft layout (minecraft-layout.js output) and the
// generated tile map summary (victory-map.js tiles.json). Keeps textures and the existing building models, stadium
// stands, collision footprints and character tints; replaces positions, ground shapes, zones, NPC spots and the
// review route.
// With a map folder, buildings, props, the stadium dome and trees are written into the DS Map Studio map instead
// (upper layers, collisions in the .per files) and world.json keeps only ferries, decks, fences, NPCs, zones and route.
// Usage: node victory-world.js <world.json> <victory-mc.json> <tiles.json> <out world.json> [map folder]
const fs = require('fs');

const [WORLD, MC, TILES, OUT, MAPDIR] = process.argv.slice(2);
const old = JSON.parse(fs.readFileSync(WORLD, 'utf8'));
const mc = JSON.parse(fs.readFileSync(MC, 'utf8'));
const tiles = JSON.parse(fs.readFileSync(TILES, 'utf8'));
const T = 20, [OX, OZ] = tiles.offset, SEA_Y = -10, LEVEL_Y = T;
const r1 = (v) => Math.round(v * 10) / 10;
// Minecraft cell coordinates (fractional) -> hub world units
const wx = (gx) => r1((gx + OX) * T), wz = (gz) => r1((gz + OZ) * T);
const tileLevel = (x, z) => { const cx = Math.floor(x / T), cz = Math.floor(z / T); return tiles.level[cz]?.[cx] ?? 0; };
const tileWalk = (x, z) => { const cx = Math.floor(x / T), cz = Math.floor(z / T); return !!tiles.walk[cz]?.[cx]; };
const lot = (role) => mc.lots.find((l) => l.role === role);
const sign = (role) => mc.signs.find((s) => s.role === role);

// ---------- ground ----------
const ground = { textures: { ...old.ground.textures, water: 'dsms/victory-island/export/sea_lm1.png' },
  tiles: { obj: 'dsms/victory-island/export/VictoryIsland.obj', per: 'dsms/victory-island/VictoryIsland', maps: [tiles.width / 32, tiles.height / 32], x: 0, z: 0, size: T },
  rectangles: [], rings: [] };
const centroid = (r) => { const p = r.points || [[r.x, r.z], [r.x + r.w, r.z + r.d]]; return [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length]; };
// stadium: stands, truss, court, emblem and lawn around the old centre, scaled into the new lot
const oldStadium = [576, 192], stadiumLot = lot('stadium');
const newStadium = [wx(stadiumLot.cx), wz(stadiumLot.cz)], S = (stadiumLot.x1 - stadiumLot.x0) * T / 375;
const moveS = ([x, z]) => [r1(newStadium[0] + (x - oldStadium[0]) * S), r1(newStadium[1] + (z - oldStadium[1]) * S)];
for (const r of old.ground.rectangles) {
  if (r.kind !== 'box' && r.kind !== 'deco') continue;
  const c = centroid(r);
  if (Math.hypot(c[0] - oldStadium[0], c[1] - oldStadium[1]) > 200) continue;
  const n = { ...r, points: (r.points || [[r.x, r.z], [r.x + r.w, r.z], [r.x + r.w, r.z + r.d], [r.x, r.z + r.d]]).map(moveS) };
  delete n.x; delete n.z; delete n.w; delete n.d;
  if (n.kind === 'box') { n.height = r1(r.height * S); if (r.base) n.base = r1(r.base * S); }
  if (n.kind === 'deco') n.overTiles = true;
  ground.rectangles.push(n);
}
// decks: ramps are single rectangles reaching their landing levels; flat decks become row-merged rectangles
const deckRects = [];
for (const d of mc.decks) {
  const y0 = d.ends[0].level * LEVEL_Y, y1 = d.ends[1].level * LEVEL_Y;
  if (d.ramp) {
    let a0 = d.ends[0].at, a1 = d.ends[1].at;
    const across = d.axis === 'x' ? [d.z0, d.z1] : [d.x0, d.x1];
    const mid = (across[0] + across[1]) / 2;
    const levelAlong = (a) => d.axis === 'x' ? tileLevel(wx(a + 0.5), wz(mid)) : tileLevel(wx(mid), wz(a + 0.5));
    // stretch each end over the cliff rings until the tile under it is at that end's level
    for (let k = 0; k < 5 && levelAlong(a0) !== d.ends[0].level; k++) a0--;
    for (let k = 0; k < 5 && levelAlong(a1) !== d.ends[1].level; k++) a1++;
    const rect = d.axis === 'x' ? { x: wx(a0), z: wz(d.z0), w: (a1 - a0 + 1) * T, d: (d.z1 - d.z0) * T } : { x: wx(d.x0), z: wz(a0), w: (d.x1 - d.x0) * T, d: (a1 - a0 + 1) * T };
    deckRects.push({ kind: 'pier', texture: 'pier', ...rect, y: y0, y2: y1, axis: d.axis });
  } else {
    const set = new Set(d.cellsList.map(([x, z]) => `${x},${z}`));
    const rows = {};
    for (const [x, z] of d.cellsList) (rows[z] = rows[z] || []).push(x);
    let open = []; // runs carried down while identical
    const emit = (run) => deckRects.push({ kind: 'pier', texture: 'pier', x: wx(run.x0), z: wz(run.z0), w: (run.x1 - run.x0) * T, d: (run.z1 - run.z0) * T, y: y0 });
    const zs = Object.keys(rows).map(Number).sort((a, b) => a - b);
    for (let zi = 0; zi <= zs.length; zi++) {
      const z = zs[zi], runs = [];
      if (z !== undefined) { const xs = rows[z].sort((a, b) => a - b); let s0 = xs[0], p = xs[0];
        for (const x of xs.slice(1).concat([Infinity])) { if (x !== p + 1) { runs.push({ x0: s0, x1: p + 1 }); s0 = x; } p = x; } }
      const next = [];
      for (const o of open) { const same = z === o.z1 && runs.find((r) => r.x0 === o.x0 && r.x1 === o.x1); if (same) { o.z1++; same.used = true; next.push(o); } else emit(o); }
      for (const r of runs) if (!r.used) next.push({ x0: r.x0, x1: r.x1, z0: z, z1: z + 1 });
      open = next;
    }
    void set;
  }
}
// ramps from plank decks down onto the beach: where a deck edge has walkable ground one level below for two
// tiles, a wooden ramp one to three tiles wide; at most three, spread out
{
  const deckLevelAt = new Map((tiles.decks || []).map(([x, z, l]) => [x + ',' + z, l]));
  const sand = (tx, tz, lv) => !deckLevelAt.has(tx + ',' + tz) && tiles.walk[tz]?.[tx] && tiles.level[tz][tx] === lv - 1;
  const placed = [];
  for (const n of [3, 2, 1]) for (const [dx, dz, axis] of [[0, 1, 'z'], [0, -1, 'z'], [1, 0, 'x'], [-1, 0, 'x']]) for (const [key, lv] of deckLevelAt) {
    if (placed.length >= 3 || lv < 1) continue;
    const [tx, tz] = key.split(',').map(Number);
    const along = axis === 'z' ? [1, 0] : [0, 1];
    const run = [...Array(n)].map((_, k) => [tx + along[0] * k, tz + along[1] * k]);
    if (!run.every(([a, b]) => deckLevelAt.get(a + ',' + b) === lv && sand(a + dx, b + dz, lv) && sand(a + 2 * dx, b + 2 * dz, lv))) continue;
    if (placed.some(([a, b]) => Math.hypot(a - tx, b - tz) < 10)) continue;
    placed.push([tx, tz]);
    const y = lv * LEVEL_Y, x0 = Math.min(...run.map((c) => c[0] + dx)), z0 = Math.min(...run.map((c) => c[1] + dz));
    const rect = axis === 'z' ? { x: x0 * T, z: (dz > 0 ? tz + 1 : tz - 2) * T, w: n * T, d: 2 * T } : { x: (dx > 0 ? tx + 1 : tx - 2) * T, z: z0 * T, w: 2 * T, d: n * T };
    // "y" is the low-coordinate end: the ramp slopes down away from the deck
    deckRects.push({ kind: 'pier', texture: 'pier', ...rect, y: dx + dz > 0 ? y : y - LEVEL_Y, y2: dx + dz > 0 ? y - LEVEL_Y : y, axis, beachRamp: true });
  }
  console.log('beach ramps', placed.length);
}
// decks and bridges are plank tiles in the map; only the ramps down to the beach stay as hub shapes (polygons)
deckRects.splice(0, deckRects.findIndex((r) => r.beachRamp) < 0 ? deckRects.length : deckRects.findIndex((r) => r.beachRamp));
ground.rectangles.push(...deckRects.map(({ x, z, w, d, beachRamp, ...rest }) => ({ ...rest, points: [[x, z], [x + w, z], [x + w, z + d], [x, z + d]].map(([a, b]) => [r1(a), r1(b)]) })));
// daycare fence: unnamed lot pieces near the daycare sign
const daycare = sign('daycare');
for (const l of mc.lots) if (!l.role && daycare && Math.hypot(l.cx - daycare.x, l.cz - daycare.z) < 9) {
  const thinX = l.x1 - l.x0 <= l.z1 - l.z0, cx = wx(l.cx), cz = wz(l.cz);
  const w = thinX ? 6 : (l.x1 - l.x0) * T, d = thinX ? (l.z1 - l.z0) * T : 6;
  const fx = r1(cx - w / 2), fz = r1(cz - d / 2);
  ground.rectangles.push({ kind: 'box', texture: 'railing', side: 'railing', points: [[fx, fz], [r1(fx + w), fz], [r1(fx + w), r1(fz + d)], [fx, r1(fz + d)]], height: 12 });
}

// ---------- models ----------
const models = [], blockers = [], sprites = [], zones = [];
const oldModel = (file) => old.models.find((m) => m.file.endsWith(file));
// models not used before are found in the converted model folders under the data directory
const DATA = 'C:/Projects/hub-work', FOLDERS = ['buildings-glb', 'houses-glb', 'decor-glb', 'props-glb', 'pwt-glb'];
const modelPath = (file) => { const name = file.replace(/.glb$/, '');
  for (const d of FOLDERS) if (fs.existsSync(`${DATA}/${d}/${name}/${file}`)) return `${d}/${name}/${file}`;
  throw new Error('Model not found under ' + DATA + ': ' + file); };
const oldBlockersNear = (m) => old.blockers.filter((b) => m.x >= b.x - 30 && m.x <= b.x + b.w + 30 && m.z >= b.z - 30 && m.z <= b.z + b.d + 30 && b.w * b.d > 400);
// fit = [lotWidth, lotDepth] in world units: the model (and its old footprint) grows to fill about 80% of the lot
// clip: optional lot rectangle in world units; footprints never reach past the lot the building was drawn on
function place(file, x, z, extra = {}, keepBlockers = true, fit = null, clip = null) {
  const o = oldModel(file) || { file: modelPath(file), x, z, scale: 1 };
  const near = keepBlockers ? oldBlockersNear(o) : [];
  let f = 1;
  if (fit && near.length) {
    const fw = Math.max(...near.map((b) => b.x + b.w)) - Math.min(...near.map((b) => b.x)), fd = Math.max(...near.map((b) => b.z + b.d)) - Math.min(...near.map((b) => b.z));
    f = Math.max(1, Math.min(2.5, 0.8 * Math.min(fit[0] / fw, fit[1] / fd)));
  }
  const m = { file: o.file || file, x: r1(x), z: r1(z), ...(o.rotY ? { rotY: o.rotY } : {}), scale: Math.round((o.scale ?? 1) * f * 100) / 100, ...extra };
  models.push(m);
  for (const b of near) {
    let bx = x + (b.x - o.x) * f, bz = z + (b.z - o.z) * f, bx2 = bx + b.w * f, bz2 = bz + b.d * f;
    if (clip) { bx = Math.max(bx, clip.x0); bz = Math.max(bz, clip.z0); bx2 = Math.min(bx2, clip.x1); bz2 = Math.min(bz2, clip.z1); }
    if (bx2 > bx && bz2 > bz) blockers.push({ x: r1(bx), z: r1(bz), w: r1(bx2 - bx), d: r1(bz2 - bz) });
  }
  return m;
}
const atLot = (role) => { const l = lot(role); return l && [wx(l.cx), wz(l.cz)]; };
const front = (role) => { const l = lot(role); return l && [wx(l.cx), wz(l.z1) + 14]; }; // just south of the door side
const roleModels = { dome: 'c04tcourt_01.glb', hall: 'c5_rbuild_01.glb', auction: 'c5_market_01.glb', ferris: 'c04_fwheel_01.glb',
  theater: 'c04theater_01.glb', games: 'pc_01.glb', corner: 'c1_rest_01.glb', tutor: 'c12_house_01.glb', mart: 'pc_01.glb', lighthouse: 'c5_lhouse_01.glb', statue: 'c5_statue_01.glb' };
for (const [role, file] of Object.entries(roleModels)) { const p = atLot(role), l = lot(role); if (p) place(file, p[0], p[1], {}, true, [(l.x1 - l.x0) * T, (l.z1 - l.z0) * T], { x0: wx(l.x0), z0: wz(l.z0), x1: wx(l.x1), z1: wz(l.z1) }); }
// filler lots: a house that can't be entered, picked by the lot's size (tile sizes in DS Map Studio)
const FILLER_BY_SIZE = { '4x3': 'c5_house_02', '3x3': 'c7_house_01', '3x4': 'c13_house_03', '3x2': 'c14_house_02' };
for (const l of mc.lots.filter((q) => q.role === 'filler'))
  place((FILLER_BY_SIZE[(l.x1 - l.x0) + 'x' + (l.z1 - l.z0)] || 'c7_house_01') + '.glb', wx(l.cx), wz(l.cz), {}, true, [(l.x1 - l.x0) * T, (l.z1 - l.z0) * T], { x0: wx(l.x0), z0: wz(l.z0), x1: wx(l.x1), z1: wz(l.z1) });
// Ferris wheel rim
const fw = atLot('ferris'); const oldRing = old.ground.rings[0];
if (fw && oldRing) ground.rings.push({ ...oldRing, x: fw[0], z: fw[1] });
// leaderboards in front of the Trainer Hall
const hf = front('hall'); if (hf) ['sign01.glb', 'sign02.glb', 'sign01.glb'].forEach((f, i) => place(f, hf[0] + (i - 1) * 30, hf[1] + 6, {}, false));
// vine arches across the garden paths (bars along x span east-west)
// (a bar marks the beam across the path; a whole arch footprint is 4x5 for a north-south walk, 5x4 turned)
for (const l of mc.lots.filter((q) => q.role === 'arch')) {
  const w = l.x1 - l.x0, d = l.z1 - l.z0, bar = Math.min(w, d) === 1;
  place('c01arch_01.glb', wx(l.cx), wz(l.cz), { rotY: (bar ? w >= d : d >= w) ? 0 : 90 }, false);
}
// fountain and its lamp ring
if (mc.fountain) {
  const [fx, fz] = [wx(mc.fountain[0]), wz(mc.fountain[1])];
  place('wbt_fountain.glb', fx, fz, { scale: 0.66 }, false);
  blockers.push({ x: r1(fx - 32), z: r1(fz - 32), w: 64, d: 64 });
  for (let i = 0; i < 8; i++) { const a = (i + 0.5) * Math.PI / 4; place('c03_slamp_02.glb', fx + Math.cos(a) * 110, fz + Math.sin(a) * 110, {}, false); }
  zones.push({ name: 'Central Fountain', x: fx, z: fz, radius: 80 });
}
// ferries: the upright hull fits the long-in-z ship, the flat one the long-in-x ship; they float at sea level
const shipUp = mc.ships.find((s) => s.z1 - s.z0 > s.x1 - s.x0), shipFlat = mc.ships.find((s) => s !== shipUp);
const ferries = [];
for (const [s, file, name] of [[shipUp, 'c13_ship_01.glb', 'Event Ferry'], [shipFlat, 'c03_ship_02.glb', 'Journeys Ferry']]) {
  if (!s) continue;
  const x = wx(s.cx), z = wz(s.cz);
  place(file, x, z, { y: 14 }, false);
  blockers.push({ x: wx(s.x0), z: wz(s.z0), w: (s.x1 - s.x0) * T, d: (s.z1 - s.z0) * T });
  ferries.push([name, x, z]);
}
// parasols: one per cluster of coloured stairs
const ps = mc.parasols.map((p) => [wx(p.cx), wz(p.cz)]), done = [];
for (const p of ps) if (!done.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 60)) done.push(p);
done.forEach((p, i) => place(i % 2 ? 'o_parasol_02.glb' : 'o_parasol_01.glb', p[0], p[1], {}, false));
// beach towels: a deck chair on each, lying along the towel
for (const t of mc.towels || []) place('o_chair_01.glb', wx(t.cx), wz(t.cz), { rotY: t.x1 - t.x0 > t.z1 - t.z0 ? 90 : 0, scale: 1 }, false);
// trees: billboards on the green markers, about one per two tiles
const treeTex = ['tree', 'tree2', 'pine'], planted = [];
for (const t of mc.trees) for (let z = t.z0; z < t.z1; z++) for (let x = t.x0; x < t.x1; x++) {
  const p = [wx(x + 0.5), wz(z + 0.5)];
  if (planted.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 32)) continue;
  planted.push(p);
  const k = planted.length;
  sprites.push({ texture: treeTex[k % 3], x: p[0], z: p[1], h: r1(48 + (k * 7) % 12), block: 7 });
}
// stadium floodlights and bracket screen move with the stands
for (const s of old.sprites) if (s.texture === 'flood' || s.texture === 'bracket') {
  const [x, z] = moveS([s.x, s.z]); sprites.push({ ...s, x, z, h: r1(s.h * S), y: r1((s.y || 0) * S) });
}

// ---------- zones ----------
const zoneOf = (name, role, radius, view) => { const p = atLot(role); if (p) zones.push({ name, x: p[0], z: p[1], radius, ...(view ? { view } : {}) }); };
zoneOf('PWT Stadium', 'stadium', 150, 420); zoneOf('Battle Dome', 'dome', 90, 380); zoneOf('Trainer Hall', 'hall', 70);
zoneOf('Auction House', 'auction', 50); zoneOf('Ferris Wheel', 'ferris', 60, 420); zoneOf('Costume Shop', 'theater', 50);
zoneOf('Game Shop', 'games', 50); zoneOf('TM Shop', 'tutor', 50); zoneOf('Poke Mart', 'mart', 50); zoneOf('Game Corner', 'corner', 50); zoneOf('Lighthouse', 'lighthouse', 50);
zoneOf('Statue Island', 'statue', 60);
const archLots = mc.lots.filter((q) => q.role === 'arch');
if (archLots.length) zones.push({ name: 'Garden', x: wx(archLots.reduce((s, l) => s + l.cx, 0) / archLots.length), z: wz(archLots.reduce((s, l) => s + l.cz, 0) / archLots.length), radius: 110 });
if (daycare) zones.push({ name: 'Daycare', x: wx(daycare.x), z: wz(daycare.z), radius: 80 });
if (ps.length) zones.push({ name: 'Beach', x: r1(ps.reduce((s, p) => s + p[0], 0) / ps.length), z: r1(ps.reduce((s, p) => s + p[1], 0) / ps.length), radius: 120 });
for (const [name, x, z] of ferries) zones.push({ name, x, z, radius: 90 });
const breezeway = mc.lots.filter((l) => !l.role && Math.hypot(l.cx - lot('stadium').cx, l.cz - lot('stadium').cz) < 25);
if (breezeway.length) zones.push({ name: 'Breezeway', x: wx(breezeway[0].cx), z: wz((Math.min(...breezeway.map((l) => l.z0)) + Math.max(...breezeway.map((l) => l.z1))) / 2), radius: 60 });

// ---------- buildings, props, dome and trees into the DS Map Studio map ----------
if (MAPDIR) {
  const path = require('path');
  const index = {};
  for (const line of fs.readFileSync(path.join(MAPDIR, 'model-tile-index.txt'), 'utf8').split('\n')) {
    const [id, obj, size] = line.split('\t'); if (!size) continue;
    const [w, h] = size.split('x').map(Number); index[obj.replace(/.obj$/, '')] = { id: +id, w, h };
  }
  const mapFile = path.join(MAPDIR, 'VictoryIsland.pdsmap'), lines = fs.readFileSync(mapFile, 'utf8').split('\n');
  const maps = {}; // "mx,my" -> { tiles: [8][32][32] file rows, heights: [8][32][32] }
  for (let i = 0; i < lines.length; i++) if (lines[i] === 'mapstart') {
    const key = lines[i + 1].trim().split(' ').join(','), m = { tiles: [], heights: [] }; let k = i + 2;
    while (lines[k] !== 'mapend') {
      if (lines[k] === 'tilegrid' || lines[k] === 'heightgrid') { (lines[k] === 'tilegrid' ? m.tiles : m.heights).push(lines.slice(k + 1, k + 33).map((r) => r.trim().split(' ').map(Number))); k += 33; } else k++;
    }
    maps[key] = m;
  }
  const occupied = Array.from({ length: 8 }, () => new Set());
  for (let l = 1; l < 8; l++) for (const [key, m] of Object.entries(maps)) { const [mx, my] = key.split(',').map(Number);
    m.tiles[l].forEach((row, fr) => row.forEach((v, x) => { if (v >= 0) occupied[l].add(`${mx * 32 + x},${my * 32 + 31 - fr}`); })); }
  const blockedCells = new Set();
  function putTile(id, w, h, x0, zSouth, level) {
    const cells = []; for (let dz = 0; dz < h; dz++) for (let dx = 0; dx < w; dx++) cells.push(`${x0 + dx},${zSouth - dz}`);
    if (cells.some((c) => { const [a, b] = c.split(',').map(Number); return a < 0 || b < 0 || a >= tiles.width || b >= tiles.height; })) return false;
    for (let l = 1; l < 8; l++) if (!cells.some((c) => occupied[l].has(c))) {
      cells.forEach((c) => occupied[l].add(c));
      const m = maps[`${Math.floor(x0 / 32)},${Math.floor(zSouth / 32)}`], fr = 31 - (zSouth % 32);
      m.tiles[l][fr][x0 % 32] = id; m.heights[l][fr][x0 % 32] = level;
      return true;
    }
    return false;
  }
  const placeModel = (name, x, z) => { const t = index[name]; if (!t) return false;
    const x0 = Math.round(x / T - t.w / 2), zSouth = Math.round(z / T + t.h / 2) - 1;
    return putTile(t.id, t.w, t.h, x0, zSouth, tileLevel(x, z)); };
  // stadium: the Pokeathlon Dome replaces the stands, court and floodlights
  const st = atLot('stadium');
  if (st && placeModel('poke_c_dome2', st[0], st[1])) {
    const t = index.poke_c_dome2, x0 = Math.round(st[0] / T - t.w / 2), z0 = Math.round(st[1] / T - t.h / 2);
    for (let dz = 1; dz < t.h - 1; dz++) for (let dx = 1; dx < t.w - 1; dx++) blockedCells.add(`${x0 + dx},${z0 + dz}`);
    ground.rectangles = ground.rectangles.filter((r) => r.kind === 'pier' || !(r.kind === 'box' && r.texture !== 'railing' || r.kind === 'deco'));
    for (let i = sprites.length - 1; i >= 0; i--) if (sprites[i].texture === 'flood' || sprites[i].texture === 'bracket') sprites.splice(i, 1);
  }
  // Pokeathlon glass archway over the walkway south of the stadium (the unnamed lots there), walked through
  if (breezeway.length && index.poke_c_obj) {
    const bx = (Math.min(...breezeway.map((l) => l.x0)) + Math.max(...breezeway.map((l) => l.x1))) / 2;
    const bz = (Math.min(...breezeway.map((l) => l.z0)) + Math.max(...breezeway.map((l) => l.z1))) / 2;
    placeModel('poke_c_obj', wx(bx), wz(bz));
  }
  // models: everything except the ferries moves into the map
  const keep = [];
  for (const m of models) {
    const name = path.basename(m.file, '.glb') + (Math.round(m.rotY || 0) % 180 === 90 ? '_r90' : '');
    if (/ship/.test(name) || !placeModel(name, m.x, m.z)) keep.push(m);
  }
  models.splice(0, models.length, ...keep);
  // paved aprons (footprint plus one tile) for victory-map.js
  const aprons = blockers.filter((b) => !keep.some((m) => /ship/.test(m.file) && m.x >= b.x && m.x <= b.x + b.w && m.z >= b.z && m.z <= b.z + b.d))
    .map((b) => ({ x0: Math.floor(b.x / T) - 1, z0: Math.floor(b.z / T) - 1, x1: Math.floor((b.x + b.w) / T) + 1, z1: Math.floor((b.z + b.d) / T) + 1, level: tileLevel(b.x + b.w / 2, b.z + b.d / 2) }));
  fs.writeFileSync(path.join(MAPDIR, 'aprons.json'), JSON.stringify(aprons));
  // footprints become collisions; ferry footprints stay as blockers
  for (const b of blockers.splice(0)) {
    if (keep.some((m) => /ship/.test(m.file) && m.x >= b.x && m.x <= b.x + b.w && m.z >= b.z && m.z <= b.z + b.d)) { blockers.push(b); continue; }
    for (let cz = Math.floor(b.z / T); cz <= Math.floor((b.z + b.d) / T); cz++) for (let cx = Math.floor(b.x / T); cx <= Math.floor((b.x + b.w) / T); cx++)
      if ((cx + 0.5) * T > b.x && (cx + 0.5) * T < b.x + b.w && (cz + 0.5) * T > b.z && (cz + 0.5) * T < b.z + b.d) blockedCells.add(`${cx},${cz}`);
  }
  // filler houses (not enterable) in open grass near the town's buildings, doors south; never on paths, and only
  // where every place stays reachable
  {
    const FILLERS = mc.lots.some((l) => l.role === 'filler') ? [] : ['c7_house_01', 'c13_house_03', 'c12_house_02', 'c7_house_02', 'c13_house_04', 'c14_house_02', 'c5_house_02', 'c7_house_03', 'c6_house_01', 'c2_build_01'];
    const town = mc.lots.filter((l) => l.role && !['stadium', 'dome', 'hall', 'statue', 'arch', 'lighthouse'].includes(l.role));
    const gx = (x) => x - OX, gz = (z) => z - OZ;
    const grassAt = (x, z) => mc.ground[gz(z)]?.[gx(x)] === 'grass' && !mc.lots.some((l) => gx(x) >= l.x0 && gx(x) < l.x1 && gz(z) >= l.z0 && gz(z) < l.z1);
    const used = (x, z) => occupied.some((o) => o.has(x + ',' + z)) || blockedCells.has(x + ',' + z) || !tiles.walk[z]?.[x];
    const reach = (extra) => { // walkable tiles reachable from the spawn side of the fountain, with extra cells blocked
      const ok = (x, z) => tiles.walk[z]?.[x] && !blockedCells.has(x + ',' + z) && !extra.has(x + ',' + z);
      const fx = Math.floor(wx(mc.fountain[0]) / T), fz = Math.floor(wz(mc.fountain[1]) / T) + 4;
      const seen = new Set(), q = [[fx, fz]];
      for (let i = 0; i < q.length; i++) { const [x, z] = q[i]; const k = x + ',' + z; if (seen.has(k) || !ok(x, z)) continue; seen.add(k);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) q.push([x + dx, z + dz]); }
      return seen;
    };
    let base = reach(new Set());
    const placedFillers = [];
    const spots = [];
    for (const l of town) for (let z = l.z0 - 9; z <= l.z1 + 9; z++) for (let x = l.x0 - 9; x <= l.x1 + 9; x++) spots.push([x + OX, z + OZ, Math.hypot(x - l.cx, z - l.cz)]);
    spots.sort((p, q) => p[2] - q[2]);
    for (const [x0, zN] of spots) {
      if (placedFillers.length >= 14) break;
      const name = FILLERS[placedFillers.length % FILLERS.length], t = index[name]; if (!t) continue;
      const cells = []; for (let dz = 0; dz < t.h; dz++) for (let dx = 0; dx < t.w; dx++) cells.push([x0 + dx, zN + dz]);
      if (!cells.every(([x, z]) => grassAt(x, z) && !used(x, z) && tiles.level[z]?.[x] === 1)) continue;
      // the tiles around may be other buildings (a town row), but not cliffs, water or fences; the door side stays open
      const ring = []; for (let dz = -1; dz <= t.h; dz++) for (let dx = -1; dx <= t.w; dx++) if (dz < 0 || dx < 0 || dz >= t.h || dx >= t.w) ring.push([x0 + dx, zN + dz]);
      if (!ring.every(([x, z]) => tiles.walk[z]?.[x] || blockedCells.has(x + ',' + z))) continue;
      if (![...Array(t.w)].every((_, dx) => tiles.walk[zN + t.h]?.[x0 + dx] && !blockedCells.has((x0 + dx) + ',' + (zN + t.h)))) continue;
      const extra = new Set(cells.map(([x, z]) => x + ',' + z)), after = reach(extra);
      if (after.size + extra.size < base.size) continue; // something became unreachable
      if (!putTile(t.id, t.w, t.h, x0, zN + t.h - 1, 1)) continue;
      cells.forEach(([x, z]) => blockedCells.add(x + ',' + z));
      base = after; placedFillers.push(name);
    }
    console.log('filler houses', placedFillers.length);
  }
  // trees: a Platinum 2x2 tree on every 2x2 square of tree blocks (scanned north-west first)
  const treeTiles = [879, 881];
  sprites.splice(0);
  let treeCount = 0;
  for (const t of mc.trees) {
    const cellsOf = new Set((t.cellsList || []).map(([x, z]) => x + ',' + z)), used = new Set();
    const order = [...(t.cellsList || [])].sort((p, q) => p[1] - q[1] || p[0] - q[0]);
    for (const [x, z] of order) {
      const sq = [[x, z], [x + 1, z], [x, z + 1], [x + 1, z + 1]].map((c) => c.join(','));
      if (!sq.every((k) => cellsOf.has(k) && !used.has(k))) continue;
      const x0 = x + OX, zSouth = z + 1 + OZ;
      if (!putTile(treeTiles[treeCount++ & 1], 2, 2, x0, zSouth, tileLevel(wx(x + 1), wz(z + 1)))) continue;
      sq.forEach((k) => used.add(k));
      for (const c of [[x0, zSouth], [x0 + 1, zSouth], [x0, zSouth - 1], [x0 + 1, zSouth - 1]]) blockedCells.add(c.join(','));
    }
  }
  console.log('trees', treeCount);
  // write the map and collisions
  let txt = '';
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== 'mapstart') continue;
    const key = lines[i + 1].trim(), m = maps[key.split(' ').join(',')];
    txt += `mapstart
${key}
areaindex
${lines[i + 3].trim()}
`;
    for (const g of m.tiles) txt += 'tilegrid\n' + g.map((r) => r.join(' ') + ' \n').join('');
    for (const g of m.heights) txt += 'heightgrid\n' + g.map((r) => r.join(' ') + ' \n').join('');
    txt += 'mapend\n';
  }
  fs.writeFileSync(mapFile, lines.slice(0, lines.indexOf('mapstart')).join('\n') + '\n' + txt);
  for (const key of Object.keys(maps)) {
    const [mx, my] = key.split(',').map(Number), file = path.join(MAPDIR, `VictoryIsland_${String(mx).padStart(2, '0')}_${String(my).padStart(2, '0')}.per`);
    const per = fs.readFileSync(file);
    for (const c of blockedCells) { const [cx, cz] = c.split(',').map(Number);
      if (Math.floor(cx / 32) !== mx || Math.floor(cz / 32) !== my) continue;
      per[((cz % 32) * 32 + (cx % 32)) * 2 + 1] = 0x80; tiles.walk[cz][cx] = false; }
    fs.writeFileSync(file, per);
  }
  console.log(`map props: ${Object.values(occupied).reduce((s, o) => s + o.size, 0)} cells used, ${blockedCells.size} cells blocked, ${keep.length} models left in world.json`);
}

// ---------- walkable grid (tiles + decks, minus footprints) for NPCs and the review route ----------
const STEP = 5, radius = 6;
const inRect = (r, x, z, m = 0) => x >= r.x - m && x <= r.x + r.w + m && z >= r.z - m && z <= r.z + r.d + m;
const tileDeck = new Map((tiles.decks || []).map(([x, z, l]) => [x + ',' + z, l]));
const bridgeStair = new Map(); for (const b of tiles.bridgeStairs || []) for (const [x, z] of b.cells) bridgeStair.set(x + ',' + z, b);
const deckAt = (x, z) => { const k = Math.floor(x / T) + ',' + Math.floor(z / T);
  if (tileDeck.has(k)) { const b = bridgeStair.get(k), base = tileDeck.get(k) * LEVEL_Y; if (!b) return base;
    const fx = x / T - Math.floor(x / T), fz = z / T - Math.floor(z / T);
    return base + LEVEL_Y * (b.dir === 'N' ? 1 - fz : b.dir === 'S' ? fz : b.dir === 'E' ? fx : 1 - fx); }
  let best = null; for (const r of deckRects) if (inRect(r, x, z)) {
  const t = r.y2 === undefined ? 0 : Math.max(0, Math.min(1, r.axis === 'x' ? (x - r.x) / r.w : (z - r.z) / r.d));
  const y = r.y + ((r.y2 ?? r.y) - r.y) * t; best = best === null ? y : Math.max(best, y); } return best; };
const fence = ground.rectangles.filter((r) => r.kind === 'box');
const boxPoly = (r, x, z) => { const p = r.points; if (!p) return inRect(r, x, z, radius); let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > z) !== (p[j][1] > z) && x < (p[j][0] - p[i][0]) * (z - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; return c; };
const solid = (x, z) => blockers.some((b) => inRect(b, x, z, radius)) || fence.some((r) => boxPoly(r, x, z)) || sprites.some((s) => s.block && Math.hypot(s.x - x, s.z - z) < s.block + radius);
// stairs climb one level across their cells toward dir
const stairCell = new Map();
for (const st of tiles.stairs || []) for (let k = 0; k < (st.width || 3); k++) { const wide = st.dir === 'N' || st.dir === 'S'; stairCell.set(`${st.x + (wide ? k : 0)},${st.y + (wide ? 0 : k)}`, st.dir); }
const heightAt = (x, z) => { const d = deckAt(x, z); if (d !== null) return d;
  const cx = Math.floor(x / T), cz = Math.floor(z / T), dir = stairCell.get(`${cx},${cz}`), base = tileLevel(x, z) * LEVEL_Y;
  if (!dir) return base;
  const fx = x / T - cx, fz = z / T - cz;
  return base + LEVEL_Y * (dir === 'N' ? 1 - fz : dir === 'S' ? fz : dir === 'E' ? fx : 1 - fx); };
// plank decks are walkable through the collision files (fences on them block); only the hub's ramp shapes add walkable ground
const onRamp = (x, z) => deckRects.some((r) => inRect(r, x, z));
const walkable = (x, z) => (onRamp(x, z) || tileWalk(x, z)) && !solid(x, z)
  && [[-radius, 0], [radius, 0], [0, -radius], [0, radius]].every(([dx, dz]) => onRamp(x + dx, z + dz) || tileWalk(x + dx, z + dz));
const GW = tiles.width * T / STEP, GH = tiles.height * T / STEP;
const gridOk = new Uint8Array(GW * GH);
for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) gridOk[j * GW + i] = walkable(i * STEP + 2.5, j * STEP + 2.5) ? 1 : 0;
const nearestOk = (x, z) => { let best = null, bd = Infinity;
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) if (gridOk[j * GW + i]) { const d = Math.hypot(i * STEP + 2.5 - x, j * STEP + 2.5 - z); if (d < bd) { bd = d; best = [i, j]; } }
  return best; };
function route(from, to) { // breadth-first over the walk grid, no step above 6 units between neighbours
  const start = nearestOk(...from), goal = nearestOk(...to), prev = new Int32Array(GW * GH).fill(-1), q = [start[1] * GW + start[0]];
  prev[q[0]] = q[0];
  for (let qi = 0; qi < q.length; qi++) { const c = q[qi]; if (c === goal[1] * GW + goal[0]) break;
    const ci = c % GW, cj = (c / GW) | 0, ch = heightAt(ci * STEP + 2.5, cj * STEP + 2.5);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ni = ci + di, nj = cj + dj, n = nj * GW + ni;
      if (ni < 0 || nj < 0 || ni >= GW || nj >= GH || !gridOk[n] || prev[n] >= 0) continue;
      if (Math.abs(heightAt(ni * STEP + 2.5, nj * STEP + 2.5) - ch) > 6) continue;
      prev[n] = c; q.push(n); } }
  const g = goal[1] * GW + goal[0];
  if (prev[g] < 0) { // report the closest reached point to help fix the layout
    let best = null, bd = Infinity; for (const c of q) { const d = Math.hypot((c % GW) - goal[0], ((c / GW) | 0) - goal[1]); if (d < bd) { bd = d; best = c; } }
    // the place itself may sit inside a footprint: stop at the closest reachable point if it is near enough
    if (bd * STEP > 150) { console.error('route: from', from, 'to', to, 'closest reached', [(best % GW) * STEP, ((best / GW) | 0) * STEP]); return null; }
    const path = []; for (let c = best; ; c = prev[c]) { path.push([(c % GW) * STEP + 2.5, ((c / GW) | 0) * STEP + 2.5]); if (prev[c] === c) break; }
    return path.reverse(); }
  const path = []; for (let c = g; ; c = prev[c]) { path.push([(c % GW) * STEP + 2.5, ((c / GW) | 0) * STEP + 2.5]); if (prev[c] === c) break; }
  return path.reverse();
}
const clearLine = (a, b) => { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2); let h = heightAt(...a);
  for (let k = 1; k <= n; k++) { const x = a[0] + (b[0] - a[0]) * k / n, z = a[1] + (b[1] - a[1]) * k / n, i = Math.floor(x / STEP), j = Math.floor(z / STEP);
    if (!gridOk[j * GW + i]) return false; const nh = heightAt(x, z); if (Math.abs(nh - h) > 3) return false; h = nh;
    // stairs are climbed head-on only: a straight run may cross them only along their direction
    const dir = stairCell.get(`${Math.floor(x / T)},${Math.floor(z / T)}`);
    if (dir) { const ddx = Math.abs(b[0] - a[0]), ddz = Math.abs(b[1] - a[1]); if ((dir === 'N' || dir === 'S') ? ddx > 0.2 * ddz : ddz > 0.2 * ddx) return false; } } return true; };
const simplify = (path) => { const out = [path[0]]; let i = 0;
  while (i < path.length - 1) { let j = path.length - 1; while (j > i + 1 && !clearLine(path[i], path[j])) j--; out.push(path[j]); i = j; } return out; };

// spawn just south of the fountain
const fountainZone = zones.find((z) => z.name === 'Central Fountain');
const spawnCell = nearestOk(fountainZone.x, fountainZone.z + 60), spawn = { x: spawnCell[0] * STEP + 2.5, z: spawnCell[1] * STEP + 2.5 };

// ---------- NPCs ----------
const npcs = [], tints = old.npcs.map((n) => n.tints);
const npcAt = (name, x, z, facing, wander) => { const c = nearestOk(x, z); npcs.push({ name, x: c[0] * STEP + 2.5, z: c[1] * STEP + 2.5, facing, tints: tints[npcs.length % tints.length], ...(wander ? { wander } : {}) }); };
const ev = sign('event'), jr = sign('journeys');
if (jr) npcAt('Journeys Portmaster', wx(jr.x), wz(jr.z), 2); if (ev) npcAt('Event Portmaster', wx(ev.x), wz(ev.z), 2);
if (daycare) npcAt('Daycare Keeper', wx(daycare.x), wz(daycare.z), 0);
const spots = zones.filter((z) => !/Ferry|Statue/.test(z.name));
for (let i = 0; i < 26; i++) { const z = spots[i % spots.length], a = i * 2.4, r = 30 + (i % 3) * 18;
  npcAt(`Townsperson ${i + 1}`, z.x + Math.cos(a) * r, z.z + Math.sin(a) * r, i % 4, 30 + (i % 4) * 15); }
// every NPC blocks its own spot, so keep them off the route below
const npcSolid = (x, z) => npcs.some((n) => Math.hypot(n.x - x, n.z - z) < 20);
for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) if (gridOk[j * GW + i] && npcSolid(i * STEP + 2.5, j * STEP + 2.5)) gridOk[j * GW + i] = 0;

// ---------- review route: spawn -> stadium -> Battle Dome -> garden -> beach -> boardwalk -> ferries ----------
const stops = [['stadium', 'PWT Stadium'], ['dome', 'Battle Dome'], ['garden', 'Garden'], ['beach', 'Beach'], ['harbor', 'Journeys Ferry']];
const review = [{ name: '01-start', x: spawn.x, z: spawn.z, run: false }];
let here = [spawn.x, spawn.z], n = 2;
const first = nearestOk(spawn.x - 40, spawn.z); review.push({ name: '02-walking', x: first[0] * STEP + 2.5, z: first[1] * STEP + 2.5, run: false }); here = [review[1].x, review[1].z]; n = 3;
for (const [tag, zone] of stops) {
  const z = zones.find((q) => q.name === zone); if (!z) continue;
  const p = route(here, [z.x, z.z]); if (!p) throw new Error('No walkable route to ' + zone);
  const pts = simplify(p).slice(1);
  pts.forEach((q, k) => review.push({ name: `${String(n++).padStart(2, '0')}-${tag}${k === pts.length - 1 ? '' : '-' + (k + 1)}`, x: r1(q[0]), z: r1(q[1]), run: true }));
  here = pts[pts.length - 1];
}

// ---------- collision checks ----------
const blocked = [[wx(-3), wz(-3)], [wx(mc.width + 2), wz(mc.height / 2)]];
for (const role of ['dome', 'hall', 'auction', 'mart', 'tutor', 'games', 'corner', 'theater', 'lighthouse']) { const p = atLot(role); if (p) blocked.push(p); }
for (const [, x, z] of ferries) blocked.push([x, z]);

const world = { worldScale: old.worldScale, ground, models, blockers, zones, spawn, review, npcs, sprites, checks: { blocked } };
fs.writeFileSync(OUT, JSON.stringify(world, null, 2) + '\n');
console.log(`models ${models.length}, blockers ${blockers.length}, sprites ${sprites.length}, npcs ${npcs.length}, zones ${zones.length}, review ${review.length}, decks ${deckRects.length}`);
console.log(zones.map((z) => `${z.name} (${z.x}, ${z.z})`).join('\n'));
