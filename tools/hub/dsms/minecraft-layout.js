// Turns an area of a Minecraft Bedrock world into a Victory Island layout: one block column = one tile.
// Ground: grass/dirt -> grass, sand -> beach, slabs/stone -> paving, bricks -> brick, light blue concrete -> fountain
// plaza, water -> sea. Height of the ground surface becomes the level (thresholds below). Marker blocks standing on
// the ground are collected as features: netherrack = building lots, quartz = ships, planks = decks (bridges,
// boardwalk, piers), green concrete or leaves = trees, concrete stairs = parasols (small quartz = parasol poles).
// Sign text names the lot it stands on or next to.
// Each block becomes scale x scale tiles (default 1) so one-block details such as path outlines stay readable.
// Usage: node minecraft-layout.js <world db folder> <x0> <z0> <x1> <z1> <out.json> [scale]
const fs = require('fs');
const { readWorld, readWorldSigns } = require('./bedrock-world.js');

const [db, X0, Z0, X1, Z1, OUT, SCALE = '1'] = process.argv.slice(2);
const K = Math.max(1, Math.round(+SCALE));
const x0 = Math.min(+X0, +X1), x1 = Math.max(+X0, +X1), z0 = Math.min(+Z0, +Z1), z1 = Math.max(+Z0, +Z1);
const world = readWorld(db);
const { signs } = readWorldSigns(db);
const W = x1 - x0 + 1, H = z1 - z0 + 1;
// order matters: the first matching key names the marker
const MARKERS = { netherrack: 'lot', quartz: 'ship', planks: 'deck', green_concrete: 'tree', leaves: 'tree', concrete_stairs: 'parasol', _wall: 'wall', pale_oak_fence: 'wall', fence: 'fence', _stairs: 'stairs' };
// Bedrock stairs climb toward weirdo_direction: 0 east, 1 west, 2 south, 3 north
const STAIR_DIR = ['E', 'W', 'S', 'N'];
const marker = (b) => Object.keys(MARKERS).find((k) => b.includes(k));
const groundOf = (b) => b.includes('water') ? 'sea' : b.includes('grass') || b.includes('dirt') ? 'grass'
  : b.includes('sand') ? 'beach' : (b.includes('brick') && !b.includes('stone')) || b.includes('red_concrete') ? 'brick'
  : b.includes('light_blue_concrete') ? 'fountain' : b.includes('lapis') ? 'river' : b.includes('orange_concrete') ? 'track' : 'pave';
// (lapis: river and waterfall water above sea level; orange concrete: Pokeathlon track)
// Ground surface y -> level: low rim, town, raised islands.
// Ground block y -> level: sea and beach, town (109), Battle Dome island (111), stadium island (113).
// Above that, every two blocks is one more level (hills and cliffs built higher than the stadium island).
const levelOf = (y) => (y <= 108 ? 0 : y < 110.75 ? 1 : y < 112.75 ? 2 : 3 + Math.max(0, Math.floor((y - 112.75) / 2)));

const cells = [];
const feature = { lot: [], ship: [], deck: [], tree: [], parasol: [], towel: [] };
for (let z = z0; z <= z1; z++) {
  const row = [];
  for (let x = x0; x <= x1; x++) {
    let y = 200, b = 'minecraft:air';
    for (; y > -64; y--) { b = world.blockAt(x, y, z); if (b !== 'minecraft:air' && !b.includes('sign') && !b.includes('structure')) break; }
    let kind = null, top = y, plankTop = null, stair = null, overlay = null, cellUnderAir = false;
    // walls and fences stand on the ground or on a deck; stairs are walked on; the rest are features
    while (marker(b)) {
      const k = MARKERS[marker(b)];
      if (k === 'wall' || k === 'fence') overlay = overlay || k;
      else if (k === 'stairs') stair = stair || STAIR_DIR[world.stateAt(x, y, z).weirdo_direction] || 'N';
      else { kind = kind || k; if (k === 'deck' && plankTop === null) { plankTop = y + 1; { // headroom: two or more air blocks under the planks with dry ground below (not water) is a walk-under arch
          let g = 0; while (g < 8 && world.blockAt(x, y - 1 - g, z) === 'minecraft:air') g++;
          const below = world.blockAt(x, y - 1 - g, z);
          if (g >= 2 && below !== 'minecraft:air' && !below.includes('water')) cellUnderAir = true; } } }
      y--; b = world.blockAt(x, y, z);
    }
    if (plankTop !== null) kind = 'deck'; // a fence or wall on planks is still part of the deck
    const markerBottom = y;
    // quartz laid as floor (not floating on water) is a white floor, not a ship
    // quartz on land: one block thick is a white floor, a taller column is a parasol pole (ground stays below)
    if (kind === 'ship' && !b.includes('water') && b !== 'minecraft:air') {
      if (b.includes('sand')) kind = 'towel'; // quartz on the beach: a towel to lie on
      else if (top - markerBottom === 1) { kind = null; b = 'minecraft:smooth_stone'; y = markerBottom + 1; } else kind = 'parasol';
    }
    // walk-under markers (arches, decks): the ground is below the air gap
    if (kind && b === 'minecraft:air') { let yy = y; while (yy > 60 && world.blockAt(x, yy, z) === 'minecraft:air') yy--; y = yy; b = world.blockAt(x, yy, z); }
    let ground, surface;
    if (kind === 'lot' && (b === 'minecraft:air' || b.includes('water'))) {
      ground = 'pave'; surface = markerBottom + 1; // a lot built straight on the water: its lowest block is the floor
    } else {
      if (b === 'minecraft:air') b = 'minecraft:water';
      surface = y + (b.includes('slab') && !b.includes('double') ? 0.5 : 1);
      ground = groundOf(b);
    }
    const cell = { ground, level: ground === 'sea' ? 0 : levelOf(surface - 1), y: surface };
    if (kind) { cell.marker = kind; cell.top = top + 1; }
    if (plankTop !== null) cell.plankTop = plankTop;
    if (cellUnderAir) cell.underAir = true;
    if (overlay) cell.overlay = overlay;
    if (stair) cell.stair = stair;
    row.push(cell);
  }
  cells.push(row);
}
// connected marker regions (4-neighbour) -> features with bounds, centre, base and top heights
const seen = cells.map((r) => r.map(() => false));
for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
  const k = cells[z][x].marker;
  if (!k || seen[z][x]) continue;
  const stack = [[x, z]], members = []; seen[z][x] = true;
  while (stack.length) {
    const [cx, cz] = stack.pop(); members.push([cx, cz]);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= W || nz >= H || seen[nz][nx] || cells[nz][nx].marker !== k) continue;
      seen[nz][nx] = true; stack.push([nx, nz]);
    }
  }
  const xs = members.map((m) => m[0]), zs = members.map((m) => m[1]);
  const f = { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs) + 1, z1: Math.max(...zs) + 1, cells: members.length,
    base: Math.min(...members.map(([a, b]) => cells[b][a].y)), top: Math.max(...members.map(([a, b]) => cells[b][a].top)) };
  f.cx = (f.x0 + f.x1) / 2; f.cz = (f.z0 + f.z1) / 2;
  if (k === 'deck' || k === 'tree') f.cellsList = members;
  if (k === 'ship' && members.length < 20) continue; // parasol poles
  // planks held up on posts with open air below (a pergola over a path) are a vine arch, not a deck
  if (k === 'deck' && members.filter(([a, b]) => cells[b][a].underAir).length * 3 > members.length) {
    for (const [a, b] of members) { delete cells[b][a].plankTop; cells[b][a].marker = 'lot'; }
    f.role = 'arch'; f.sign = 'plank arch'; feature.lot.push(f); continue;
  }
  feature[k].push(f);
}
// sign roles: each sign names the nearest lot within 3 tiles; NPC roles stay at the sign itself
const ROLES = [[/filler/i, 'filler'], [/game corner/i, 'corner'], [/breezeway|vine|arch/i, 'arch'], [/stadium/i, 'stadium'], [/battle dome/i, 'dome'], [/trainer hall|leaderboard/i, 'hall'], [/auction/i, 'auction'],
  [/ferris/i, 'ferris'], [/fun building|costume/i, 'theater'], [/game area|game item/i, 'games'], [/2 story|tm shop|tutor/i, 'tutor'],
  [/lighthouse/i, 'lighthouse'], [/apartment/i, 'apartments'], [/statue/i, 'statue'], [/daycare/i, 'daycare'], [/event|raid/i, 'event'], [/journeys/i, 'journeys'],
  [/market|shop|mart/i, 'mart']];
const NPC_ROLES = new Set(['daycare', 'event', 'journeys']);
const signList = signs.filter((g) => g.x >= x0 && g.x <= x1 && g.z >= z0 && g.z <= z1)
  .map((g) => ({ text: g.text, x: g.x - x0 + 0.5, z: g.z - z0 + 0.5, role: (ROLES.find(([re]) => re.test(g.text)) || [])[1] || null }));
const boxDist = (f, x, z) => Math.hypot(Math.max(f.x0 - x, 0, x - f.x1), Math.max(f.z0 - z, 0, z - f.z1));
// a row of buildings built touching is one netherrack region: split it along its length halfway between the signs on it
const buildingSign = (g) => g.role && g.role !== 'arch' && !NPC_ROLES.has(g.role);
for (const f of [...feature.lot]) {
  const on = signList.filter((g) => buildingSign(g) && boxDist(f, g.x, g.z) === 0);
  if (on.length < 2) continue;
  const alongX = f.x1 - f.x0 >= f.z1 - f.z0, key = alongX ? 'x' : 'z';
  on.sort((a, b) => a[key] - b[key]);
  const cuts = [f[key + '0'], ...on.slice(1).map((g, i) => Math.round((on[i][key] + g[key]) / 2)), f[key + '1']];
  feature.lot.splice(feature.lot.indexOf(f), 1);
  for (let i = 0; i < on.length; i++) {
    const p = { ...f, [key + '0']: cuts[i], [key + '1']: cuts[i + 1] };
    p.cx = (p.x0 + p.x1) / 2; p.cz = (p.z0 + p.z1) / 2; p.cells = (p.x1 - p.x0) * (p.z1 - p.z0);
    feature.lot.push(p);
  }
}
for (const g of signList) {
  if (!g.role || NPC_ROLES.has(g.role)) continue;
  if (g.role === 'arch') { // a garden sign names every unnamed bar near it
    for (const f of feature.lot) if (!f.role && boxDist(f, g.x, g.z) <= 6) { f.role = 'arch'; f.sign = g.text; }
    continue;
  }
  const near = feature.lot.filter((f) => !f.role).sort((a, b) => boxDist(a, g.x, g.z) - boxDist(b, g.x, g.z))[0];
  if (near && boxDist(near, g.x, g.z) <= 3) { near.role = g.role; near.sign = g.text; }
}
// no stadium sign: the largest unnamed lot is the stadium
if (!feature.lot.some((f) => f.role === 'stadium')) {
  const big = feature.lot.filter((f) => !f.role).sort((a, b) => (b.x1 - b.x0) * (b.z1 - b.z0) - (a.x1 - a.x0) * (a.z1 - a.z0))[0];
  if (big) big.role = 'stadium';
}
// building lots keep the ground below them; the map gets a paved apron around each building's footprint instead
// decks: a straight bridge between two levels becomes a ramp. Each end is pushed along the bridge over lower land
// (cliff rings) until it reaches the level that path is heading for; end levels come from the land just beyond.
for (const d of feature.deck) {
  const alongX = d.x1 - d.x0 >= d.z1 - d.z0;
  d.axis = alongX ? 'x' : 'z';
  const span = alongX ? [d.z0, d.z1] : [d.x0, d.x1];
  const landLevel = (a) => { // highest land level across the deck's width at position a along the axis
    let best = -1;
    for (let b = span[0]; b < span[1]; b++) {
      const [x, z] = alongX ? [a, b] : [b, a];
      if (x < 0 || z < 0 || x >= W || z >= H) continue;
      const c = cells[z][x]; if (c.ground !== 'sea' && c.marker !== 'deck') best = Math.max(best, c.level);
    }
    return best;
  };
  const ends = alongX ? [d.x0, d.x1 - 1] : [d.z0, d.z1 - 1];
  d.ends = [-1, 1].map((dir, i) => {
    let a = ends[i] + dir, level = landLevel(a), reach = a;
    for (let k = 0; k < 6 && level >= 0; k++) { // keep going while the land ahead rises
      const next = landLevel(a + dir * (k + 1));
      if (next > level) { level = next; reach = a + dir * (k + 1); } else if (next < 0) break;
    }
    return { at: level >= 0 && reach !== a ? reach - dir : ends[i], level: level >= 0 ? level : null };
  });
  // an end over open water (a pier tip) keeps the level of the other end
  for (const [i, j] of [[0, 1], [1, 0]]) if (d.ends[i].level === null) d.ends[i].level = d.ends[j].level ?? 1;
  const tops = d.cellsList.map(([x, z]) => cells[z][x].plankTop).filter((v) => v).sort((a, b) => a - b);
  d.level = levelOf(tops[Math.floor(tops.length / 2)] - 1);
  d.ends.forEach((e) => (e.level = d.level));
  d.ramp = false;
}
// fountain: centre of the light blue concrete
const fountain = [];
cells.forEach((r, z) => r.forEach((c, x) => { if (c.ground === 'fountain') fountain.push([x + 0.5, z + 0.5]); }));
const out = {
  source: { x0, z0, x1, z1 },
  width: W, height: H,
  ground: cells.map((r) => r.map((c) => (c.ground === 'fountain' ? 'brick' : c.ground))),
  level: cells.map((r) => r.map((c) => c.level)),
  surface: cells.map((r) => r.map((c) => c.y)),
  fences: cells.flatMap((r, z) => r.map((c, x) => c.overlay ? [x, z, c.overlay, c.plankTop ? levelOf(c.plankTop - 1) : c.level] : null)).filter(Boolean),
  stairs: (() => { // 4-connected flights with their climbing direction, the levels in front of and behind them
    const done = new Set(), out = [];
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      if (!cells[z][x].stair || done.has(x + ',' + z)) continue;
      const dir = cells[z][x].stair, stack = [[x, z]], flight = []; done.add(x + ',' + z);
      while (stack.length) { const [a, b] = stack.pop(); flight.push([a, b]);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const p = a + dx, q = b + dz;
          if (p >= 0 && q >= 0 && p < W && q < H && cells[q][p].stair === dir && !done.has(p + ',' + q)) { done.add(p + ',' + q); stack.push([p, q]); } } }
      const [ux, uz] = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[dir];
      const levelAt = (p, q) => { const c = cells[q]?.[p]; if (!c) return null; return c.plankTop ? levelOf(c.plankTop - 1) : c.ground === 'sea' ? null : c.level; };
      // in front: the first cell past the low end; behind: the first cell past the high end
      const front = flight.map(([a, b]) => levelAt(a - ux, b - uz)).filter((v, i) => v !== null && !cells[flight[i][1] - uz]?.[flight[i][0] - ux]?.stair);
      const back = flight.map(([a, b]) => levelAt(a + ux, b + uz)).filter((v, i) => v !== null && !cells[flight[i][1] + uz]?.[flight[i][0] + ux]?.stair);
      out.push({ dir, cells: flight, lo: front.length ? Math.min(...front) : null, hi: back.length ? Math.max(...back) : null });
    }
    return out;
  })(),
  lots: feature.lot, ships: feature.ship, decks: feature.deck, trees: feature.tree, parasols: feature.parasol, towels: feature.towel,
  signs: signList,
  fountain: fountain.length ? [fountain.reduce((s, p) => s + p[0], 0) / fountain.length, fountain.reduce((s, p) => s + p[1], 0) / fountain.length] : null,
};
// upscale: every block becomes K x K tiles; feature coordinates are multiplied (deck end positions keep their side)
if (K > 1) {
  const up = (grid) => grid.flatMap((row) => Array.from({ length: K }, () => row.flatMap((v) => Array(K).fill(v))));
  out.ground = up(out.ground); out.level = up(out.level); out.surface = up(out.surface);
  out.width *= K; out.height *= K; out.scale = K;
  const box = (f) => { for (const k of ['x0', 'z0', 'x1', 'z1', 'cx', 'cz']) if (k in f) f[k] *= K; };
  for (const f of [...out.lots, ...out.ships, ...out.trees, ...out.parasols, ...out.towels]) box(f);
  for (const d of out.decks) {
    box(d);
    d.cellsList = d.cellsList.flatMap(([x, z]) => { const c = []; for (let a = 0; a < K; a++) for (let b = 0; b < K; b++) c.push([x * K + a, z * K + b]); return c; });
    d.ends[0].at = d.ends[0].at * K; d.ends[1].at = d.ends[1].at * K + K - 1;
  }
  for (const g of out.signs) { g.x *= K; g.z *= K; }
  out.fences = out.fences.flatMap(([x, z, t, l]) => { const c = []; for (let a = 0; a < K; a++) for (let b = 0; b < K; b++) c.push([x * K + a, z * K + b, t, l]); return c; });
  for (const st of out.stairs) st.cells = st.cells.flatMap(([x, z]) => { const c = []; for (let a = 0; a < K; a++) for (let b = 0; b < K; b++) c.push([x * K + a, z * K + b]); return c; });
  if (out.fountain) out.fountain = out.fountain.map((v) => v * K);
}
fs.writeFileSync(OUT, JSON.stringify(out));
const ch = { sea: '~', grass: 'g', beach: 'b', pave: 'p', brick: 'r' };
console.log(cells.map((r) => r.map((c) => c.marker === 'lot' ? 'N' : c.marker === 'ship' ? 'Q' : c.marker === 'deck' ? '=' : ch[c.ground === 'fountain' ? 'brick' : c.ground]).join('') + '  ' + r.map((c) => (c.ground === 'sea' ? '~' : c.level)).join('')).join('\n'));
for (const g of out.signs) console.log('sign', g.role, g.x, g.z);
for (const st of out.stairs) console.log('stairs', st.dir, 'lo', st.lo, 'hi', st.hi, JSON.stringify(st.cells));
console.log('walls/fences', out.fences.length);
console.log(`${W}x${H} cells; trees ${feature.tree.length}, parasols ${feature.parasol.length}; lots ${feature.lot.length}, ships ${feature.ship.length}, decks ${feature.deck.length}, fountain ${JSON.stringify(out.fountain)}`);
for (const f of feature.lot) console.log('lot', f.role || '-', JSON.stringify({ cx: f.cx, cz: f.cz, w: f.x1 - f.x0, d: f.z1 - f.z0, cells: f.cells, base: f.base, top: f.top }));
for (const f of feature.ship) console.log('ship', JSON.stringify({ cx: f.cx, cz: f.cz, w: f.x1 - f.x0, d: f.z1 - f.z0 }));
for (const f of feature.deck) console.log('deck', JSON.stringify({ x0: f.x0, z0: f.z0, x1: f.x1, z1: f.z1, cells: f.cells, base: f.base, axis: f.axis, ends: f.ends, ramp: f.ramp }));
