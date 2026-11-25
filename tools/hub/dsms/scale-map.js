// Reads a hand-edited Victory Island DS Map Studio map back into a layout (the format of minecraft-layout.js and
// victory-design-1to1.js) at a larger scale, so the same island can be rebuilt with room for the ROM buildings at
// their native size (1:1, 16 DS units per tile).
// Ground comes from each tile's measured colours (tile-sig.json, 3x3 samples): every new cell takes the samples of
// its own part of the old tile, so coasts and path edges keep their shape. Levels come from the height grid plus the
// tile's own surface heights (tile-z.json), so cliffs land between the right levels. Decks (planks, and the .per
// bridge behaviour), fences, rails, trees and the Pokeathlon track are carried over; model tiles become building lots
// at the native footprint of their model (front edge and centre kept), ships and props stay where they were.
// Names: the old hub's signs (world.json) name the buildings next to them.
// Hand placements: SCALE_ADJUST=<json> {model: {cx, front, name, add}} moves (or with add: true adds) buildings.
// Usage: node scale-map.js <oldMapDir> <tile-sig.json> <tile-z.json> <old world.json> <out-layout.json> <out-godot-layout.json> [scale]
const fs = require('fs');
const path = require('path');
const { convert } = require('./glb-to-obj.js');

const [OLD, SIGFILE, ZFILE, WORLD, OUT, GODOT, SCALE = '2'] = process.argv.slice(2);
const K = +SCALE;
const SIG = JSON.parse(fs.readFileSync(SIGFILE, 'utf8')), TZ = JSON.parse(fs.readFileSync(ZFILE, 'utf8'));
const NAME = 'VictoryIsland';

// ---- old map ----
const lines = fs.readFileSync(path.join(OLD, NAME + '.pdsmap'), 'utf8').split(/\r?\n/).map((s) => s.trim());
const maps = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i] === 'mapstart') { const [x, y] = lines[i + 1].split(/\s+/).map(Number); maps.push({ x, y, t: [], h: [] }); }
  else if (lines[i] === 'tilegrid' || lines[i] === 'heightgrid') {
    const g = lines.slice(i + 1, i + 33).map((r) => r.split(/\s+/).map(Number));
    maps[maps.length - 1][lines[i] === 'tilegrid' ? 't' : 'h'].push(g); i += 32;
  }
}
const OW = (Math.max(...maps.map((m) => m.x)) + 1) * 32, OH = (Math.max(...maps.map((m) => m.y)) + 1) * 32;
const layers = Array.from({ length: 8 }, () => ({ t: Array.from({ length: OH }, () => Array(OW).fill(-1)), h: Array.from({ length: OH }, () => Array(OW).fill(0)) }));
for (const m of maps) for (let l = 0; l < 8; l++) for (let a = 0; a < 32; a++) for (let b = 0; b < 32; b++) {
  const x = m.x * 32 + b, z = m.y * 32 + 31 - a; layers[l].t[z][x] = m.t[l][a][b]; layers[l].h[z][x] = m.h[l][a][b];
}
const per = (x, z) => { const b = fs.readFileSync(path.join(OLD, `${NAME}_${String(Math.floor(x / 32)).padStart(2, '0')}_${String(Math.floor(z / 32)).padStart(2, '0')}.per`)), o = ((z % 32) * 32 + (x % 32)) * 2; return [b[o], b[o + 1]]; };
const perCache = {}; const perAt = (x, z) => (perCache[x + ',' + z] ??= per(x, z));
const index = {};
for (const l of fs.readFileSync(path.join(OLD, 'model-tile-index.txt'), 'utf8').split(/\r?\n/)) {
  const p = l.split('\t'); if (p.length >= 3 && /^\d+$/.test(p[0]) && /x/.test(p[2])) { const [w, h] = p[2].split('x').map(Number); index[+p[0]] = { name: p[1].replace(/\.obj$/, ''), w, h }; }
}

// ---- tile meanings ----
const REF = { sea: 1170, beach: 1181, grass: 1157, pave: 1167, path: 1166, brick: 1165 };
const refColour = Object.fromEntries(Object.entries(REF).map(([k, id]) => [k, SIG[id].r[4]]));
const classify = (c) => { if (!c) return null; let best = null, bd = Infinity;
  for (const [k, r] of Object.entries(refColour)) { const d = (c[0] - r[0]) ** 2 + (c[1] - r[1]) ** 2 + (c[2] - r[2]) ** 2; if (d < bd) { bd = d; best = k; } } return best; };
const FLOWERS = new Set([1171, 1172, 1173]);
const CLIFFS = new Set([454, 455, 456, 457, 458, 459, 460, 461, 686, 687, 688, 689]);
const PLANKS = new Set([370, 368, 369, 358, 1245, 1249, 171]);
const FENCE = new Map([...[381, 382, 383, 384, 385, 386, 387].map((t) => [t, 'fence']), ...[389, 390, 391, 392, 393, 394, 395].map((t) => [t, 'wall'])]);
const TREES = new Set([879, 881]);
const TRACK = (t) => index[t]?.name.startsWith('track_');
// the sample (3x3, NW N NE / W C E / SW S SE) indices covering each part of an old tile split K x K
const part = (i) => (K === 1 ? [0, 1, 2] : i === 0 ? [0, 1] : i === K - 1 ? [1, 2] : [1]);
const samples = (i, j) => part(j).flatMap((r) => part(i).map((c) => r * 3 + c));

// ---- new grid ----
const W = OW * K, H = OH * K;
const ground = Array.from({ length: H }, () => Array(W).fill(null)), level = Array.from({ length: H }, () => Array(W).fill(0));
for (let z = 0; z < OH; z++) for (let x = 0; x < OW; x++) {
  const t = layers[0].t[z][x], h = layers[0].h[z][x], z5 = TZ[t]?.z?.[0];
  const track = [1, 2, 3, 4, 5, 6, 7].some((l) => TRACK(layers[l].t[z][x]));
  for (let j = 0; j < K; j++) for (let i = 0; i < K; i++) {
    const nx = x * K + i, nz = z * K + j;
    let g = null, lv = h;
    if (CLIFFS.has(t) && z5) { // cliff: its corner heights split the cell into low and high parts; ground filled in later
      const corner = (i < K / 2 ? 0 : 1) + (j < K / 2 ? 0 : 2), zc = z5[corner] ?? z5[4] ?? 0;
      lv = h + Math.round(zc);
    } else if (FLOWERS.has(t)) g = 'flowers';
    else if (track) g = 'pave';
    else if (SIG[t]) {
      const votes = {}; for (const s of samples(i, j)) { const k = classify(SIG[t].r[s]); if (k) votes[k] = (votes[k] || 0) + 1; }
      const centre = classify(SIG[t].r[4]);
      g = Object.keys(votes).sort((a, b) => votes[b] - votes[a] || (b === centre) - (a === centre))[0] || centre;
    }
    if (g === 'sea') lv = 0;
    ground[nz][nx] = g; level[nz][nx] = Math.max(0, lv);
  }
}
// cells without a ground of their own (cliffs, unknown tiles) take the nearest known ground on the same level;
// a low cliff part at sea level with no ground nearby is sea
{ const q = []; for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) if (ground[z][x]) q.push([x, z]);
  for (let i = 0; i < q.length; i++) { const [x, z] = q[i];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = x + dx, b = z + dz;
      if (a < 0 || b < 0 || a >= W || b >= H || ground[b][a] || level[b][a] !== level[z][x]) continue;
      ground[b][a] = ground[z][x] === 'flowers' ? 'grass' : ground[z][x]; q.push([a, b]); } } }
for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) if (!ground[z][x]) ground[z][x] = level[z][x] === 0 ? 'sea' : 'grass';
for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
  if (ground[z][x] === 'sea') level[z][x] = 0;
  if (ground[z][x] === 'beach' && level[z][x] > 0) ground[z][x] = 'pave'; // light paving on raised ground reads as sand by colour
}

// ---- decks, fences, trees, model tiles from the upper layers ----
const deckCells = new Map(); // "x,z" -> level
const fences = [], trees = [], markers = [];
// planks are multi-cell tiles (1x3 and 3x1 pieces): every cell a plank covers is deck at the plank's height
const plankAt = new Map(); // old "x,z" -> level
for (let z = 0; z < OH; z++) for (let x = 0; x < OW; x++) for (let l = 1; l < 8; l++) {
  const t = layers[l].t[z][x]; if (!PLANKS.has(t)) continue;
  const w = TZ[t]?.w || 1, h = TZ[t]?.h || 1, lv = layers[l].h[z][x];
  for (let dz = 0; dz < h; dz++) for (let dx = 0; dx < w; dx++) { const k = `${x + dx},${z - dz}`; plankAt.set(k, Math.max(plankAt.get(k) ?? 0, lv)); }
}
for (let z = 0; z < OH; z++) for (let x = 0; x < OW; x++) {
  let deckLevel = plankAt.get(`${x},${z}`) ?? null;
  for (let l = 1; l < 8; l++) {
    const t = layers[l].t[z][x], h = layers[l].h[z][x];
    if (t < 0 || PLANKS.has(t)) continue;
    if (FENCE.has(t)) for (const [i, j] of fenceCells(t)) fences.push([x * K + i, z * K + j, FENCE.get(t), h]);
    else if (TREES.has(t)) trees.push({ x0: x * K + (K - 1), z0: (z - 1) * K + (K - 1), tile: t }); // the 2x2 tree in the middle of its scaled area
    else if (index[t] && !index[t].name.startsWith('track_') && index[t].name !== 'pokeball_plaza') markers.push({ ...index[t], x, z, level: h });
    else if (index[t]?.name === 'pokeball_plaza') markers.push({ ...index[t], x, z, level: h, plaza: true });
  }
  if (deckLevel === null && perAt(x, z)[0] === 0x73) deckLevel = layers[0].h[z][x];
  if (deckLevel !== null) for (let j = 0; j < K; j++) for (let i = 0; i < K; i++) deckCells.set(`${x * K + i},${z * K + j}`, deckLevel);
}
// stairs: the old stair tiles (3 or 2 wide, one level each), grouped into flights by column and stacked levels, then
// doubled and split into flights as wide as the old tile so they keep real stair tiles
const STAIR_TILES = { 1238: ['N', 3], 1239: ['S', 3], 1240: ['E', 3], 1241: ['W', 3], 1236: ['N', 2], 1237: ['S', 2], 1234: ['E', 2], 1235: ['W', 2] };
const stairs = [];
{ const steps = [];
  for (let z = 0; z < OH; z++) for (let x = 0; x < OW; x++) for (let l = 0; l < 8; l++) {
    const t = layers[l].t[z][x]; if (!STAIR_TILES[t]) continue;
    const [dir, width] = STAIR_TILES[t], wide = dir === 'N' || dir === 'S';
    steps.push({ dir, width, x, z, level: layers[l].h[z][x], across: wide ? x : z, along: wide ? z : x });
  }
  const flights = new Map(); // dir + across start -> steps
  for (const s of steps) { const k = s.dir + s.across; if (!flights.has(k)) flights.set(k, []); flights.get(k).push(s); }
  for (const list of flights.values()) {
    const { dir, width } = list[0], wide = dir === 'N' || dir === 'S';
    const lo = Math.min(...list.map((s) => s.level)), hi = Math.max(...list.map((s) => s.level)) + 1;
    // old cells of the flight (each stair tile covers `width` cells across), doubled
    const old = list.flatMap((s) => [...Array(width)].map((_, k) => (wide ? [s.x + k, s.z] : [s.x, s.z - k])));
    for (let part = 0; part < K; part++) {
      const cells = [];
      for (const [ox, oz] of old) for (let j = 0; j < K; j++) for (let i = 0; i < K; i++) {
        const nx = ox * K + i, nz = oz * K + j, acrossIdx = wide ? nx - list[0].across * K : nz - (list[0].across - width + 1) * K;
        if (Math.floor(acrossIdx / width) === part) cells.push([nx, nz]);
      }
      if (cells.length) stairs.push({ dir, cells, lo, hi });
    }
  }
}
// a fence piece along a scaled cell: the pieces run where the old one ran (EW along the middle row, NS the middle column)
function fenceCells(t) {
  const kind = { 382: 'EW', 390: 'EW', 385: 'NS', 393: 'NS' }[t] || 'X', m = Math.floor(K / 2), out = [];
  for (let k = 0; k < K; k++) {
    if (kind === 'EW' || kind === 'X') out.push([k, m]);
    if (kind === 'NS' || kind === 'X') out.push([m, k]);
  }
  return [...new Set(out.map((p) => p.join(',')))].map((s) => s.split(',').map(Number));
}
// decks: connected plank areas of one level
const decks = [];
{ const seen = new Set();
  for (const [key, lv] of deckCells) {
    if (seen.has(key)) continue;
    const stack = [key], cellsList = []; seen.add(key);
    while (stack.length) { const k = stack.pop(), [x, z] = k.split(',').map(Number); cellsList.push([x, z]);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = `${x + dx},${z + dz}`; if (!seen.has(n) && deckCells.get(n) === lv) { seen.add(n); stack.push(n); } } }
    const xs = cellsList.map((c) => c[0]), zs = cellsList.map((c) => c[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs) + 1, z0 = Math.min(...zs), z1 = Math.max(...zs) + 1, axis = x1 - x0 >= z1 - z0 ? 'x' : 'z';
    const [a0, a1] = axis === 'x' ? [x0, x1 - 1] : [z0, z1 - 1];
    decks.push({ x0, z0, x1, z1, cells: cellsList.length, cellsList, axis, level: lv, ramp: false, base: 0, ends: [{ at: a0, level: lv }, { at: a1, level: lv }] });
  }
}

// ---- buildings at native size ----
const HUB = path.dirname(path.dirname(path.resolve(OLD)));
const FOLDERS = ['buildings-glb', 'houses-glb', 'decor-glb', 'props-glb', 'pwt-glb', 'pokeathlon-glb', 'gen4-glb/hg2', 'gen4-glb/hg', 'gen4-glb/pt', 'gen4-glb/dome', 'stadium-glb'];
const boundsCache = {};
const bounds = (model, rot) => {
  const key = model + rot; if (boundsCache[key]) return boundsCache[key];
  const glb = FOLDERS.map((f) => path.join(HUB, f, model, model + '.glb')).find((f) => fs.existsSync(f));
  if (!glb) return null;
  return (boundsCache[key] = convert(glb, path.join(require('os').tmpdir(), 'scale-map-' + model), model, 1, 16, rot).bounds);
};
const SHIPS = new Set(['c13_ship_01', 'c03_ship_02']);
const PROPS = new Set(['poke_c_light', 'board_a', 'c03_slamp_01', 'c03_slamp_02', 'c03_slamp_03', 'c04_plant_01', 'c01fountain_01', 'c03_fountain_01', 'c15_fountain_01',
  'wbt_fountain', 'c5_statue_01', 'o_parasol_01', 'o_parasol_02', 's_parasol_01', 'o_chair_01', 'out_vender01', 'c04_poke01', 'c04_poke02', 'poke_c_flower', 'poke_c_bench',
  'poke_c_obj', 'poke_c_dome', 'c01arch_01', 'c01arch_01_r90', 'ptree_b01', 'ptree_b02', 'p_tree01_001', 'mball01', 'sign01', 'sign02', 'lamp01', 'poke_c_mon']);
const world = JSON.parse(fs.readFileSync(WORLD, 'utf8'));
const oldSigns = (world.signs || []).map((s) => ({ x: s.x / 20, z: s.z / 20, text: s.text }));
// buildings moved by hand after scaling (front edge z1 and centre x, in new tiles) so the native footprints fit;
// names for buildings without a sign of their own; buildings added to the island
const ADJUST = (process.env.SCALE_ADJUST ? JSON.parse(fs.readFileSync(process.env.SCALE_ADJUST, 'utf8')) : {});
const lots = [], ships = [], buildings = [], props = [], seenLot = new Set();
let plaza = null;
for (const m of markers) {
  // old footprint (the tile grows north from its south-west cell), scaled
  const west = m.x, east = m.x + m.w, north = m.z - m.h + 1, south = m.z + 1;
  const cx = (west + east) / 2 * K, cz = (north + south) / 2 * K, front = south * K;
  if (m.plaza) { plaza = [cx, cz, m.w * K / 2]; continue; }
  const rot = m.name.endsWith('_r90') ? 90 : 0, model = m.name.replace(/_r90$/, '');
  const key = `${model}@${west},${south}`; if (seenLot.has(key)) continue; seenLot.add(key); // a model stacked on two layers
  const b = bounds(model, rot); if (!b) { console.warn('no model for ' + model); continue; }
  const [minX, minY, maxX, maxY] = b;
  if (SHIPS.has(model)) {
    const ox = cx - (minX + maxX) / 2, oz = cz + (minY + maxY) / 2;
    ships.push({ role: model, x0: Math.floor(ox + minX), z0: Math.floor(oz - maxY), x1: Math.ceil(ox + maxX), z1: Math.ceil(oz - minY), cx: ox, cz: oz });
    buildings.push({ id: model, model, kind: 'ship', x: +ox.toFixed(2), z: +oz.toFixed(2), level: 0, rot: 0, name: model === 'c13_ship_01' ? 'Event Ferry' : 'Journeys Ferry' });
  } else if (PROPS.has(model) || m.w * m.h < 6) {
    const ox = cx - (minX + maxX) / 2, oz = cz + (minY + maxY) / 2;
    props.push({ id: `${model}_${props.length}`, model, x: +ox.toFixed(2), y: +oz.toFixed(2), level: m.level, rot, block: true, tile: true });
  } else {
    const sign = oldSigns.map((s) => ({ s, d: Math.hypot(s.x - (west + east) / 2, s.z - south) })).filter((q) => q.d < 6).sort((p, q) => p.d - q.d)[0];
    const a = ADJUST[model] || {};
    addBuilding(model, rot, a.cx ?? cx, a.front ?? front, a.name ?? (sign ? sign.s.text : model), b);
  }
}
for (const [model, a] of Object.entries(ADJUST)) if (a.add) addBuilding(model, 0, a.cx, a.front, a.name, bounds(model, 0));
// a lot sized to the model's native footprint, front edge on `front`, centred on cx, standing on the deck or ground at its door
function addBuilding(model, rot, cx, front, name, [minX, minY, maxX, maxY]) {
  const w = Math.ceil(maxX - minX - 0.05), d = Math.ceil(maxY - minY - 0.05), x0 = Math.round(cx - w / 2), z0 = front - d;
  const door = [Math.floor(x0 + w / 2), front - 1], lv = deckCells.get(door.join(',')) ?? level[door[1]][door[0]];
  lots.push({ role: model, name, x0, z0, x1: x0 + w, z1: front, cx: x0 + w / 2, cz: z0 + d / 2, cells: w * d, base: 0, top: 0, door, level: lv });
  buildings.push({ id: `${model}_${lots.length}`, model, kind: 'building', x: +(x0 + w / 2 - (minX + maxX) / 2).toFixed(2), z: +(front + minY).toFixed(2), level: lv, rot, name, door });
}
// props the moved buildings now stand on, or that block a doorstep, are left out (and listed)
{ const kept = [];
  for (const p of props) {
    const b = bounds(p.model, p.rot) || [0, 0, 0, 0];
    const px0 = p.x + b[0], px1 = p.x + b[2], pz0 = p.y - b[3], pz1 = p.y - b[1];
    const onLot = lots.some((l) => p.model !== 'poke_c_dome' && px0 < l.x1 && l.x0 < px1 && pz0 < l.z1 && l.z0 < pz1);
    const onStep = p.model !== 'poke_c_dome' && lots.some((l) => px0 < l.door[0] + 3 && l.door[0] - 2 < px1 && pz0 < l.z1 + 3 && l.z1 < pz1);
    if (onLot || onStep) console.log(`  left out ${p.model} at ${p.x},${p.y} (${onLot ? 'under a building' : 'on a doorstep'})`); else kept.push(p);
  }
  props.length = 0; props.push(...kept); }
// the dome's lobe ring shares the stadium's origin
const ring = props.find((p) => p.model === 'poke_c_dome'), stadium = buildings.find((b) => b.model === 'poke_c_dome2');
if (ring && stadium) { ring.x = stadium.x; ring.y = stadium.z; ring.tile = true; ring.block = false; } // the ring is walked past; the dome blocks
// the Poke Ball plaza: red upper half and centre on paving, as in the designs
if (plaza) {
  const [px, pz, r] = plaza;
  for (let z = Math.floor(pz - r); z < pz + r; z++) for (let x = Math.floor(px - r); x < px + r; x++) {
    const d = Math.hypot(x + 0.5 - px, z + 0.5 - pz);
    if (d <= r && ground[z]?.[x] && ground[z][x] !== 'sea') ground[z][x] = d <= r * 0.42 || (z + 0.5 < pz && d <= r) ? 'brick' : 'pave';
  }
}

// ---- out ----
const npcSigns = (world.npcs || []).filter((n) => /Portmaster/.test(n.name)).map((n) => ({ role: /Journeys/.test(n.name) ? 'journeys' : 'event', x: n.x / 20 * K, z: n.z / 20 * K, name: n.name, facing: n.facing }));
const fountain = props.find((p) => p.model === 'wbt_fountain');
fs.writeFileSync(OUT, JSON.stringify({ source: 'scale-map ' + path.basename(path.resolve(OLD)) + ' x' + K, name: NAME, width: W, height: H, ground, level, surface: level,
  fences, stairs, lots, ships, decks, trees, parasols: [], towels: [], signs: npcSigns.map(({ role, x, z }) => ({ role, x, z })),
  fountain: fountain ? [fountain.x, fountain.y] : null, fountains: props.filter((p) => /fountain/.test(p.model) && p !== fountain).map((p) => [p.x, p.y]) }));

const named = buildings.filter((b) => b.kind === 'building');
const FACING = ['down', 'left', 'right', 'up'];
const godot = {
  name: 'Victory Island', data: 'victory_island',
  spawn: { x: Math.floor(world.spawn.x / 20 * K), y: Math.floor(world.spawn.z / 20 * K), facing: 'down' },
  buildings: buildings.map((b) => ({ id: b.id, model: b.model, kind: b.kind, x: b.x, y: b.z, level: b.level, rot: b.rot, ...(b.door ? { door: b.door } : {}), name: b.name })),
  props: [...props, ...named.map((b) => ({ id: 'sign_' + b.id, model: 'board_a', x: b.door[0] - 1.5, y: b.door[1] + 1.75, level: b.level, rot: 0, block: true, for: b.id }))],
  signs: named.map((b) => ({ x: b.door[0] - 2, y: b.door[1] + 1, text: [b.name], for: b.id })),
  npcs: npcSigns.map((n) => ({ id: n.role + '_shipmaster', name: n.name, sprite: 'SPRITE_SEAMAN_2', x: Math.floor(n.x), y: Math.floor(n.z), facing: FACING[n.facing] || 'down', movement: 0, role: n.role,
    text: n.role === 'journeys' ? ['Ahoy! The Journeys ferry sails to every game you have imported.', 'Pick a journey with me once the ferry is ready.'] : ['The Event Ferry runs to special islands.', 'No events are scheduled right now.'] })),
  zones: (world.zones || []).map((zn) => ({ name: zn.name, x: +(zn.x / 20 * K).toFixed(2), y: +(zn.z / 20 * K).toFixed(2), radius: +(zn.radius / 20 * K).toFixed(2) })),
};
fs.writeFileSync(GODOT, JSON.stringify(godot, null, 2) + '\n');

const hist = {}; ground.flat().forEach((g) => (hist[g] = (hist[g] || 0) + 1));
console.log(`${W}x${H}`, 'ground', JSON.stringify(hist), 'lots', lots.length, 'ships', ships.length, 'props', props.length, 'decks', decks.length, 'fences', fences.length, 'trees', trees.length);
for (const l of lots) console.log(`  ${l.name.padEnd(16)} ${l.role.padEnd(15)} ${l.x0},${l.z0}-${l.x1},${l.z1} level ${l.level}`);
// overlaps between the native-size lots
for (let i = 0; i < lots.length; i++) for (let j = i + 1; j < lots.length; j++) { const a = lots[i], b = lots[j];
  if (a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1) console.log(`  overlap: ${a.name} / ${b.name}`); }
