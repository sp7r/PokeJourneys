// Turns a Victory Island layout read from Minecraft (minecraft-layout.js) into the Godot hub's layout, keeping what
// the previous Godot layout knew: each lot gets the model and name of the previous building nearest to it with the same
// sign role (new lots take the nearest sign's text and a stand-in house model), buildings stand on their lots at
// native size (front edge on the lot's south side, door in the middle of it), props keep their spots where the ground
// is still there, signposts are put back beside each door. Also writes the map layout for victory-map.js with the
// fixes the Minecraft reading needs: plank bridges over dry ground (read as walk-under arches) are decks again, and
// tree blocks become 2x2 Platinum tree tiles.
// Usage: node godot-layout.js <mc-layout.json> <previous godot layout.json> <out map layout.json> <out godot layout.json>
const fs = require('fs');
const path = require('path');
const os = require('os');
const { convert } = require('./glb-to-obj.js');

const [MC, PREV, OUT_MAP, OUT_GODOT] = process.argv.slice(2);
const L = JSON.parse(fs.readFileSync(MC, 'utf8')), prev = JSON.parse(fs.readFileSync(PREV, 'utf8'));
const HUB = process.env.HUB_WORK || 'C:/Projects/hub-work';
const FOLDERS = ['buildings-glb', 'houses-glb', 'decor-glb', 'props-glb', 'pwt-glb', 'pokeathlon-glb', 'gen4-glb/hg2', 'gen4-glb/hg', 'gen4-glb/pt', 'gen4-glb/dome', 'stadium-glb'];
const STAND_IN = 'c7_house_01'; // model for lots that are new in Minecraft, until one is chosen
const ROLES = [[/game corner/i, 'corner'], [/stadium/i, 'stadium'], [/battle dome/i, 'dome'], [/trainer hall|leaderboard/i, 'hall'], [/auction/i, 'auction'],
  [/ferris/i, 'ferris'], [/fun building|costume/i, 'theater'], [/game area|game item/i, 'games'], [/2 story|tm shop|tutor/i, 'tutor'],
  [/lighthouse/i, 'lighthouse'], [/apartment/i, 'apartments'], [/statue/i, 'statue'], [/market|shop|mart/i, 'mart']]; // as minecraft-layout.js
const roleOf = (name) => (ROLES.find(([re]) => re.test(name || '')) || [])[1] || null;
const levelOf = (y) => (y <= 108 ? 0 : y < 110.75 ? 1 : y < 112.75 ? 2 : 3 + Math.max(0, Math.floor((y - 112.75) / 2)));
const boundsCache = {};
const bounds = (model) => boundsCache[model] ??= (() => {
  const glb = FOLDERS.map((f) => path.join(HUB, f, model, model + '.glb')).find((f) => fs.existsSync(f));
  return glb ? convert(glb, path.join(os.tmpdir(), 'godot-layout-' + model), model, 1, 16).bounds : null;
})();

// ---- map layout fixes ----
for (const a of L.lots.filter((l) => l.role === 'arch' && l.cellsList)) { // a bridge over dry ground, not a pergola
  const axis = a.x1 - a.x0 >= a.z1 - a.z0 ? 'x' : 'z', lv = levelOf(a.top - 1), [a0, a1] = axis === 'x' ? [a.x0, a.x1 - 1] : [a.z0, a.z1 - 1];
  L.decks.push({ x0: a.x0, z0: a.z0, x1: a.x1, z1: a.z1, cells: a.cellsList.length, cellsList: a.cellsList, axis, level: lv, ramp: false, base: a.base, ends: [{ at: a0, level: lv }, { at: a1, level: lv }] });
}
L.lots = L.lots.filter((l) => l.role !== 'arch');
const treeTiles = [];
for (const t of L.trees) {
  const cells = new Set((t.cellsList || []).map(([x, z]) => x + ',' + z));
  for (let z = t.z0; z + 1 < t.z1 + 1; z += 2) for (let x = t.x0; x + 1 < t.x1 + 1; x += 2)
    if (cells.has(x + ',' + z)) treeTiles.push({ x0: x, z0: z, x1: x + 2, z1: z + 2, cx: x + 1, cz: z + 1, tile: (x + z) % 4 < 2 ? 879 : 881 });
}
L.trees = treeTiles;
const W = L.width, H = L.height, at = (x, z) => x >= 0 && z >= 0 && x < W && z < H;
// ---- stadium island: smaller, lower, further north (RESHAPE env: JSON {scale, north, lower}; default 2/3, 10, 1) ----
// The island (the land around the stadium lot, not counting bridges) is redrawn around its centre at `scale`, moved
// `north` tiles and `lower` levels down; its lots, trees, fences and props move with it; the bridges that reached it
// are lengthened along their own direction until they meet its new shore.
const RESHAPE = { scale: 2 / 3, north: 10, lower: 1, area: [100, 0, 192, 110], ...(process.env.RESHAPE ? JSON.parse(process.env.RESHAPE) : {}) };
let moveOnIsland = (x, z) => null; // old position -> new position, for things that stood on the island
const stadiumLot = L.lots.find((l) => l.role === 'stadium');
if (stadiumLot && RESHAPE.scale) {
  const island = new Set(), stack = [[Math.floor((stadiumLot.x0 + stadiumLot.x1) / 2), stadiumLot.z1]];
  while (stack.length) { const [x, z] = stack.pop(), k = x + ',' + z;
    const [ax0, az0, ax1, az1] = RESHAPE.area; // its lowest cliff step meets the town: stay inside the island's own area
    if (!at(x, z) || island.has(k) || L.ground[z][x] === 'sea' || x < ax0 || z < az0 || x >= ax1 || z >= az1) continue; island.add(k);
    stack.push([x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]); }
  const cells = [...island].map((k) => k.split(',').map(Number)), xs = cells.map((c) => c[0]), zs = cells.map((c) => c[1]);
  const cx = (Math.min(...xs) + Math.max(...xs) + 1) / 2, cz = (Math.min(...zs) + Math.max(...zs) + 1) / 2;
  const s = RESHAPE.scale, ncz = cz - RESHAPE.north;
  moveOnIsland = (x, z) => (island.has(Math.floor(x) + ',' + Math.floor(z)) ? [cx + (x - cx) * s, ncz + (z - cz) * s] : null);
  const old = { ground: L.ground.map((r) => r.slice()), level: L.level.map((r) => r.slice()) };
  for (const [x, z] of cells) { L.ground[z][x] = 'sea'; L.level[z][x] = 0; }
  const lower = (v) => Math.max(1, v - RESHAPE.lower);
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) { // each new cell samples the old island
    const ox = Math.floor(cx + (x + 0.5 - cx) / s), oz = Math.floor(cz + (z + 0.5 - ncz) / s);
    if (!island.has(ox + ',' + oz)) continue;
    const g = old.ground[oz][ox], top = old.level[oz][ox] >= 3;
    L.ground[z][x] = g === 'pave' && top ? 'track' : g; L.level[z][x] = lower(old.level[oz][ox]);
  }
  const onNew = (x, z) => at(x, z) && L.ground[z][x] !== 'sea' && moveOnIsland !== null;
  for (const l of L.lots) { const p = moveOnIsland((l.x0 + l.x1) / 2, l.z1 - 0.5); if (!p) continue;
    const w = l.x1 - l.x0, d = l.z1 - l.z0; l.x0 = Math.round(p[0] - w / 2); l.x1 = l.x0 + w; l.z1 = Math.round(p[1] + 0.5); l.z0 = l.z1 - d;
    l.levelOverride = L.level[l.z1 - 1]?.[Math.floor((l.x0 + l.x1) / 2)] ?? 2; }
  L.trees = L.trees.filter((t) => { const p = moveOnIsland(t.x0 + 1, t.z0 + 1); if (!p) return true; t.x0 = Math.round(p[0] - 1); t.z0 = Math.round(p[1] - 1);
    t.x1 = t.x0 + 2; t.z1 = t.z0 + 2; return [0, 1].every((i) => [0, 1].every((j) => L.ground[t.z0 + j]?.[t.x0 + i] === 'grass')); });
  L.fences = (L.fences || []).flatMap((f) => { const p = moveOnIsland(f[0], f[1]); return !p ? [f] : L.ground[Math.floor(p[1])]?.[Math.floor(p[0])] !== 'sea' ? [[Math.floor(p[0]), Math.floor(p[1]), f[2], lower(f[3])]] : []; });
  L.stairs = (L.stairs || []).filter((st) => !st.cells.some(([x, z]) => island.has(x + ',' + z)));
  // bridges: decks that touched the old island are lowered with it and lengthened toward its new shore
  for (const d of L.decks) {
    const touches = d.cellsList.some(([x, z]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => island.has((x + dx) + ',' + (z + dz))));
    if (!touches) continue;
    d.level = lower(d.level); for (const e of d.ends) e.level = d.level;
    const alongX = d.axis === 'x', across = [...new Set(d.cellsList.map(([x, z]) => (alongX ? z : x)))];
    const ends = d.cellsList.map(([x, z]) => (alongX ? x : z)), lo = Math.min(...ends), hi = Math.max(...ends);
    const dir = (alongX ? cx : cz - RESHAPE.north) > (lo + hi) / 2 ? 1 : -1; // toward the island's new centre
    const land = (a) => across.every((c) => { const [x, z] = alongX ? [a, c] : [c, a]; return at(x, z) && L.ground[z][x] !== 'sea'; });
    for (let a = dir > 0 ? hi + 1 : lo - 1, n = 0; n < 60 && !land(a); a += dir, n++)
      for (const c of across) d.cellsList.push(alongX ? [a, c] : [c, a]);
    const all = d.cellsList.map(([x, z]) => (alongX ? x : z));
    if (alongX) { d.x0 = Math.min(...all); d.x1 = Math.max(...all) + 1; } else { d.z0 = Math.min(...all); d.z1 = Math.max(...all) + 1; }
    d.cells = d.cellsList.length; d.ends = [{ at: Math.min(...all), level: d.level }, { at: Math.max(...all), level: d.level }];
    for (const st of L.stairs) if (st.cells.some(([x, z]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => d.cellsList.some(([a, b]) => a === x + dx && b === z + dz)))) st.hi = Math.min(st.hi, d.level);
    L.stairs = L.stairs.filter((st) => st.hi > st.lo);
  }
  console.log(`stadium island: ${cells.length} cells around ${cx.toFixed(1)},${cz.toFixed(1)} -> x${s.toFixed(2)}, ${RESHAPE.north} north, ${RESHAPE.lower} lower`);
}
// ---- river and waterfalls (lapis in Minecraft): water above sea level; a fall where the water steps down ----
const rivers = [], waterfalls = [];
for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) if (L.ground[z][x] === 'river') rivers.push([x, z, L.level[z][x]]);
{ const lowest = Math.min(...rivers.map((r) => r[2]));
  // a fall drops into lower river water, or into the sea from the river's last (lowest) stretch, not off its head
  const isWater = (x, z, from) => at(x, z) && (L.ground[z][x] === 'river' || (L.ground[z][x] === 'sea' && from === lowest));
  for (const [x, z, lv] of rivers) for (const [dx, dz, face] of [[0, 1, 'south'], [0, -1, 'north'], [1, 0, 'east'], [-1, 0, 'west']]) {
    const nx = x + dx, nz = z + dz;
    if (isWater(nx, nz, lv) && L.level[nz][nx] < lv) waterfalls.push({ x, z, face, top: lv, bottom: L.level[nz][nx] });
  } }
const groundLevel = (x, z) => L.level[Math.floor(z)]?.[Math.floor(x)] ?? 0;

// ---- buildings ----
const oldBuildings = prev.buildings.filter((b) => b.kind === 'building').map((b) => ({ ...b, role: roleOf(b.name), used: false }));
const buildings = [], lots = [];
for (const l of L.lots) {
  const cx = (l.x0 + l.x1) / 2, cz = (l.z0 + l.z1) / 2;
  const dist = (b) => Math.hypot(b.door[0] - cx, b.door[1] - cz);
  const match = oldBuildings.filter((b) => !b.used && b.role === l.role && l.role).sort((p, q) => dist(p) - dist(q))[0];
  let model, name;
  if (match) { match.used = true; model = match.model; name = match.name; }
  else {
    const sign = L.signs.map((s) => ({ s, d: Math.hypot(s.x - cx, s.z - l.z1) })).sort((p, q) => p.d - q.d)[0];
    name = sign && sign.d < 6 ? sign.s.text : 'House'; model = STAND_IN;
    console.log(`new lot at ${l.x0},${l.z0}-${l.x1},${l.z1}: "${name}" (stand-in model ${model})`);
  }
  const [minX, minY, maxX, maxY] = bounds(model);
  const door = [Math.floor(cx), l.z1 - 1], lv = l.levelOverride ?? levelOf(l.base - 1);
  buildings.push({ id: `${model}_${buildings.length + 1}`, model, kind: 'building', x: +(cx - (minX + maxX) / 2).toFixed(2), y: +(l.z1 + minY).toFixed(2), level: lv, rot: 0, door, name });
  lots.push({ ...l, name, door, level: lv });
}
for (const b of oldBuildings.filter((q) => !q.used)) console.log(`no lot for ${b.name} any more: left out`);
// ships: each Minecraft quartz ship takes the nearest previous ship's model
const oldShips = prev.buildings.filter((b) => b.kind === 'ship');
for (const s of L.ships) {
  const old = oldShips.sort((p, q) => Math.hypot(p.x - s.cx, p.y - s.cz) - Math.hypot(q.x - s.cx, q.y - s.cz)).shift();
  if (old) buildings.push({ ...old, x: s.cx, y: s.cz });
}
L.lots = lots;

// ---- props, signs, NPCs ----
const onLot = (x, z) => lots.some((l) => x >= l.x0 - 1 && x < l.x1 + 1 && z >= l.z0 - 1 && z < l.z1 + 2);
const props = [];
for (const p0 of prev.props.filter((q) => !q.for)) {
  const moved = moveOnIsland(p0.x, p0.y), p = moved ? { ...p0, x: +moved[0].toFixed(2), y: +moved[1].toFixed(2) } : p0;
  if (L.ground[Math.floor(p.y)]?.[Math.floor(p.x)] === 'sea' || onLot(p.x, p.y)) continue;
  const ring = p.model === 'poke_c_dome' ? buildings.find((b) => b.model === 'poke_c_dome2') : null;
  props.push(ring ? { ...p, x: ring.x, y: ring.y, level: ring.level } : { ...p, level: groundLevel(p.x, p.y) });
}
const named = buildings.filter((b) => b.kind === 'building');
for (const b of named) props.push({ id: 'sign_' + b.id, model: 'board_a', x: b.door[0] - 1.5, y: b.door[1] + 1.75, level: b.level, rot: 0, block: true, for: b.id });
// reached only with Waterfall (the old man's house up the falls): the check leaves these out
for (const b of named) if (/old man/i.test(b.name)) b.access = 'waterfall';
const godot = {
  ...prev,
  waters: rivers.map(([x, z, lv]) => [x, z, lv]),
  waterfalls,
  buildings, props,
  signs: named.map((b) => ({ x: b.door[0] - 2, y: b.door[1] + 1, text: [b.name], for: b.id })),
  zones: [...prev.zones.filter((z) => !named.some((b) => b.name === z.name && roleOf(z.name) === null)),
    ...named.filter((b) => !prev.zones.some((z) => z.name === b.name) && b.model === STAND_IN).map((b) => ({ name: b.name.replace(/\b\w/g, (c) => c.toUpperCase()), x: b.door[0] + 0.5, y: b.door[1] + 1.5, radius: 6 }))],
};
fs.writeFileSync(OUT_MAP, JSON.stringify(L));
fs.writeFileSync(OUT_GODOT, JSON.stringify(godot, null, 2) + '\n');
console.log(`${named.length} buildings, ${buildings.length - named.length} ships, ${props.length} props, ${L.decks.length} decks, ${L.trees.length} trees`);
