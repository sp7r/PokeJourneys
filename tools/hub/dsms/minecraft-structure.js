// Builds a Victory Island layout (victory-design-1to1.js) in Minecraft Bedrock, to edit there and read back with
// minecraft-layout.js: a behavior pack with the island as .mcstructure pieces and functions that load them.
// Blocks follow minecraft-layout.js: ground block at y 108 for sea and beach, 109 town, 111 Battle Dome island,
// 113 stadium island (solid stone below); grass, sand, smooth stone (paving), bricks, light blue concrete (fountain
// plaza); netherrack rings = building lots at their 1:1 footprint with a sign naming each; oak planks = decks and
// bridges, oak fences on them, oak stairs where a path climbs a level, quartz on the water = ships. The 128 x 128
// map is framed by a one-block glass rim (outside the map) so the sea stays in.
// Usage: node minecraft-structure.js <layout.json> <outPackDir>
// In Minecraft: add the pack to a world (cheats on), stand where the island's centre should go, run
// /function victory_island/prepare, then /function victory_island/build, then /function victory_island/done. The map's
// north-west corner is half the map's width west and north of where you stood (a sign there says so).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const [LAYOUT, OUT] = process.argv.slice(2);
const L = JSON.parse(fs.readFileSync(LAYOUT, 'utf8'));
const W = L.width, H = L.height, Y0 = 100, YN = 18; // structure spans y 100..117
const GROUND_Y = [108, 109, 111, 113];
const RIM = 1, SX = W + 2 * RIM, SZ = H + 2 * RIM, N = Math.ceil(Math.max(SX, SZ) / 64), PART = Math.ceil(Math.max(SX, SZ) / N); // N x N pieces, at most 64 a side

// ---- blocks ----
const VERSION = 18166272; // 1.21.50
const palette = [], paletteIndex = new Map();
const block = (name, states = {}) => {
  const key = name + JSON.stringify(states);
  if (!paletteIndex.has(key)) { paletteIndex.set(key, palette.length); palette.push({ name: 'minecraft:' + name, states }); }
  return paletteIndex.get(key);
};
const AIR = block('air'), STONE = block('stone'), DIRT = block('dirt'), WATER = block('water', { liquid_depth: ['int', 0] }), GLASS = block('glass');
const TOP = { grass: block('grass_block'), flowers: block('grass_block'), beach: block('sand'), pave: block('smooth_stone'), path: block('smooth_stone'),
  brick: block('brick_block'), fountain: block('light_blue_concrete'), river: block('lapis_block'), track: block('orange_concrete') };
const NETHERRACK = block('netherrack'), PLANKS = block('oak_planks'), FENCE = block('oak_fence'), QUARTZ = block('quartz_block');
const LEAVES = block('oak_leaves', { old_leaf_type: ['string', 'oak'], persistent_bit: ['byte', 1], update_bit: ['byte', 0] });
const STAIR_DIR = { E: 0, W: 1, S: 2, N: 3 }; // weirdo_direction: the way the stairs climb
const stairBlock = (dir) => block('oak_stairs', { weirdo_direction: ['int', STAIR_DIR[dir]], upside_down_bit: ['byte', 0] });
const SIGN = block('standing_sign', { ground_sign_direction: ['int', 0] }); // readable from the south

const grid = new Int32Array(SX * YN * SZ).fill(AIR); // [x][y][z], z fastest, structure coordinates
const idx = (x, y, z) => (x * YN + (y - Y0)) * SZ + z;
const set = (mx, y, mz, b) => { const x = mx + RIM, z = mz + RIM; if (x >= 0 && z >= 0 && x < SX && z < SZ && y >= Y0 && y < Y0 + YN) grid[idx(x, y, z)] = b; };
const signs = []; // { mx, y, mz, text }

// ground columns
for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
  const g = L.ground[z][x];
  if (g === 'sea') { for (let y = Y0; y < 108; y++) set(x, y, z, STONE); set(x, 108, z, WATER); continue; }
  const top = GROUND_Y[g === 'beach' ? 0 : L.level[z][x]];
  for (let y = Y0; y < top; y++) set(x, y, z, y >= top - 3 && g !== 'beach' ? DIRT : STONE);
  set(x, top, z, TOP[g] ?? TOP.grass);
}
// fountains: light blue concrete under the plaza and garden fountains
const fountains = [L.fountain, ...(L.fountains || [])].filter(Boolean);
for (const [fx, fz] of fountains) for (let z = Math.floor(fz - 3); z <= fz + 3; z++) for (let x = Math.floor(fx - 3); x <= fx + 3; x++)
  if (Math.hypot(x + 0.5 - fx, z + 0.5 - fz) <= 2.5 && L.ground[z]?.[x] && L.ground[z][x] !== 'sea') set(x, GROUND_Y[L.level[z][x]], z, TOP.fountain);
// decks: planks with their top on the deck's level; water stays below bridges
for (const d of L.decks) for (const [x, z] of d.cellsList) {
  const y = GROUND_Y[d.level];
  set(x, y, z, PLANKS);
  for (let yy = y + 1; yy < Y0 + YN; yy++) set(x, yy, z, AIR);
}
for (const [x, z, , lvl] of L.fences) set(x, GROUND_Y[lvl] + 1, z, FENCE);
// stairs: one block of rise per row toward the climb, on a solid base
for (const s of L.stairs) {
  const rows = [...new Set(s.cells.map(([x, z]) => (s.dir === 'N' || s.dir === 'S' ? z : x)))].sort((a, b) => (s.dir === 'N' || s.dir === 'W' ? b - a : a - b));
  for (const [x, z] of s.cells) {
    const k = rows.indexOf(s.dir === 'N' || s.dir === 'S' ? z : x), y = GROUND_Y[s.lo] + 1 + k;
    for (let yy = Y0; yy < y; yy++) set(x, yy, z, STONE);
    set(x, y, z, stairBlock(s.dir));
  }
}
// building lots: a netherrack ring on the ground around the footprint, a sign left of the door; a building on a deck
// stands on a paved floor at the deck's height (netherrack on planks would read back as deck)
const deckLevel = new Map(L.decks.flatMap((d) => d.cellsList.map(([x, z]) => [x + ',' + z, d.level])));
for (const l of L.lots) for (let z = l.z0; z < l.z1; z++) for (let x = l.x0; x < l.x1; x++) {
  const dl = deckLevel.get(x + ',' + z); if (dl === undefined) continue;
  for (let y = Y0; y < GROUND_Y[dl]; y++) set(x, y, z, STONE);
  set(x, GROUND_Y[dl], z, TOP.pave);
}
for (const l of L.lots) {
  const y = GROUND_Y[l.level ?? 1] + 1;
  for (let z = l.z0; z < l.z1; z++) for (let x = l.x0; x < l.x1; x++)
    if (x === l.x0 || x === l.x1 - 1 || z === l.z0 || z === l.z1 - 1) set(x, y, z, NETHERRACK);
  if (l.name) signs.push({ mx: l.door[0] - 2, y, mz: l.z1, text: l.name });
}
// trees: two blocks of oak leaves over each tree's 2x2 cells (persistent, so they don't decay)
const onLot = (x, z) => L.lots.some((l) => x >= l.x0 && x < l.x1 && z >= l.z0 && z < l.z1);
for (const t of L.trees || []) for (let z = t.z0; z < (t.z1 ?? t.z0 + 2); z++) for (let x = t.x0; x < (t.x1 ?? t.x0 + 2); x++) {
  const g = L.ground[z]?.[x]; if (!g || g === 'sea' || onLot(x, z)) continue; // buildings stand where trees were
  const y = GROUND_Y[L.level[z][x]] + 1; set(x, y, z, LEAVES); set(x, y + 1, z, LEAVES);
}
// ships: quartz floating on the water
for (const s of L.ships) for (let z = s.z0; z < s.z1; z++) for (let x = s.x0; x < s.x1; x++) set(x, 109, z, QUARTZ);
// NPC signs (ferry masters), and a corner sign to find the map again
for (const s of L.signs) {
  const x = Math.floor(s.x), z = Math.floor(s.z), g = L.ground[z]?.[x];
  const deck = L.decks.find((d) => d.cellsList.some(([a, b]) => a === x && b === z));
  const y = deck ? GROUND_Y[deck.level] + 1 : g && g !== 'sea' ? GROUND_Y[g === 'beach' ? 0 : L.level[z][x]] + 1 : 109;
  signs.push({ mx: x, y, mz: z, text: { journeys: 'Journeys Ferry', event: 'Event Ferry', daycare: 'Daycare' }[s.role] || s.role });
}
signs.push({ mx: 0, y: 109, mz: 0, text: 'Victory Island NW corner (map 0,0)' });
for (const s of signs) set(s.mx, s.y, s.mz, SIGN);
// glass rim outside the map
for (let x = 0; x < SX; x++) for (let z = 0; z < SZ; z++) if (x === 0 || z === 0 || x === SX - 1 || z === SZ - 1) for (let y = Y0; y <= 109; y++) grid[idx(x, y, z)] = GLASS;

// ---- little-endian NBT ----
const tag = { byte: 1, short: 2, int: 3, string: 8, list: 9, compound: 10 };
class Writer {
  constructor() { this.parts = []; }
  u8(v) { const b = Buffer.alloc(1); b.writeInt8(v); this.parts.push(b); }
  i16(v) { const b = Buffer.alloc(2); b.writeInt16LE(v); this.parts.push(b); }
  i32(v) { const b = Buffer.alloc(4); b.writeInt32LE(v); this.parts.push(b); }
  str(s) { const b = Buffer.from(s, 'utf8'); this.i16(b.length); this.parts.push(b); }
  // value: ['int', n] | ['byte', n] | ['string', s] | ['list', type, [values]] | ['compound', {k: value}] | ['intlist', Int32Array]
  payload([t, a, b]) {
    if (t === 'byte') this.u8(a); else if (t === 'short') this.i16(a); else if (t === 'int') this.i32(a); else if (t === 'string') this.str(a);
    else if (t === 'compound') { for (const [k, v] of Object.entries(a)) this.named(k, v); this.u8(0); }
    else if (t === 'list') { this.u8(tag[a]); this.i32(b.length); for (const v of b) this.payload([a, ...(Array.isArray(v) ? v : [v])]); }
    else if (t === 'intlist') { this.u8(tag.int); this.i32(a.length); const buf = Buffer.alloc(a.length * 4); for (let i = 0; i < a.length; i++) buf.writeInt32LE(a[i], i * 4); this.parts.push(buf); }
  }
  named(name, value) { this.u8(tag[value[0] === 'intlist' ? 'list' : value[0]]); this.str(name); this.payload(value); }
  buffer() { return Buffer.concat(this.parts); }
}
const text = (t) => ['compound', { Text: ['string', t], TextOwner: ['string', ''], SignTextColor: ['int', -16777216], IgnoreLighting: ['byte', 0], HideGlowOutline: ['byte', 0], PersistFormatting: ['byte', 1] }];

function piece(px, pz) {
  const x0 = px * PART, z0 = pz * PART, sx = Math.min(PART, SX - x0), sz = Math.min(PART, SZ - z0);
  const used = new Map(), localPalette = [], indices = new Int32Array(sx * YN * sz), positions = {};
  for (let x = 0; x < sx; x++) for (let y = 0; y < YN; y++) for (let z = 0; z < sz; z++) {
    const b = grid[idx(x0 + x, Y0 + y, z0 + z)];
    if (!used.has(b)) { used.set(b, localPalette.length); localPalette.push(palette[b]); }
    const i = (x * YN + y) * sz + z;
    indices[i] = used.get(b);
    if (b === SIGN) {
      const s = signs.find((q) => q.mx + RIM === x0 + x && q.mz + RIM === z0 + z && q.y === Y0 + y);
      positions[String(i)] = ['compound', { block_entity_data: ['compound', { id: ['string', 'Sign'], x: ['int', x], y: ['int', y], z: ['int', z],
        isMovable: ['byte', 1], IsWaxed: ['byte', 0], FrontText: text(s ? s.text : ''), BackText: text('') }] }];
    }
  }
  const states = (st) => ['compound', Object.fromEntries(Object.entries(st).map(([k, [t, v]]) => [k, [t, v]]))];
  const w = new Writer();
  w.named('', ['compound', {
    format_version: ['int', 1],
    size: ['list', 'int', [sx, YN, sz]],
    structure_world_origin: ['list', 'int', [0, 0, 0]],
    structure: ['compound', {
      block_indices: ['list', 'list', [['int', indices], ['int', new Int32Array(indices.length).fill(-1)]].map(([, arr]) => ['int', [...arr]])],
      entities: ['list', 'compound', []],
      palette: ['compound', { default: ['compound', {
        block_palette: ['list', 'compound', localPalette.map((p) => [{ name: ['string', p.name], states: states(p.states), version: ['int', VERSION] }])],
        block_position_data: ['compound', positions],
      }] }],
    }],
  }]);
  return w.buffer();
}

// ---- behavior pack ----
const uuid = () => crypto.randomUUID();
fs.mkdirSync(path.join(OUT, 'structures', 'victory_island'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'functions', 'victory_island'), { recursive: true });
const manifestFile = path.join(OUT, 'manifest.json');
const old = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : null; // keep the ids so Minecraft sees an update
fs.writeFileSync(manifestFile, JSON.stringify({
  format_version: 2,
  header: { name: `Victory Island layout ${W}x${H}`, description: 'Loads the Victory Island layout to edit', uuid: old?.header.uuid || uuid(), version: [1, 0, (old?.header.version[2] ?? -1) + 1], min_engine_version: [1, 21, 0] },
  modules: [{ type: 'data', uuid: old?.modules[0].uuid || uuid(), version: [1, 0, 0] }],
}, null, 2));
const load = [];
for (let pz = 0; pz < N; pz++) for (let px = 0; px < N; px++) {
  fs.writeFileSync(path.join(OUT, 'structures', 'victory_island', `part_${px}_${pz}.mcstructure`), piece(px, pz));
  load.push(`structure load victory_island:part_${px}_${pz} ~${px * PART - RIM - W / 2} ${Y0} ~${pz * PART - RIM - H / 2}`);
}
// ticking areas hold at most 100 chunks: one per quadrant around the centre
const half = Math.max(W, H) / 2 + RIM + 1, areas = [];
for (const [ax, az] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
  areas.push(`tickingarea add ~${ax < 0 ? -half : 0} ${Y0} ~${az < 0 ? -half : 0} ~${ax < 0 ? 0 : half} ${Y0 + YN} ~${az < 0 ? 0 : half} victory_island_${areas.length} true`);
fs.writeFileSync(path.join(OUT, 'functions', 'victory_island', 'prepare.mcfunction'),
  `# keeps the island's chunks loaded while it is built; run build next\n${areas.join('\n')}\n`);
fs.writeFileSync(path.join(OUT, 'functions', 'victory_island', 'build.mcfunction'),
  `# the map's north-west corner (0,0) is ${W / 2} blocks west and ${H / 2} north of where you stand\n${load.join('\n')}\n# afterwards: /function victory_island/done\n`);
fs.writeFileSync(path.join(OUT, 'functions', 'victory_island', 'done.mcfunction'),
  `# drops the ticking areas again\n${areas.map((_, i) => `tickingarea remove victory_island_${i}`).join('\n')}\n`);
console.log(`${palette.length} block types, ${signs.length} signs, ${L.lots.length} lots -> ${OUT}`);
