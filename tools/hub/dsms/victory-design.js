// Victory Island, designed by hand: clean island shapes, 2-tile paths, plazas, decks, stairs and placements laid out
// in code (loosely following the Minecraft sketch). Writes the same layout format as minecraft-layout.js, so
// victory-map.js and victory-world.js build the DS Map Studio map and world.json from it.
// Tiles: x east, z south, 96 x 96 (3 x 3 maps). Levels: 0 sea and beach, 1 town, 2 Battle Dome island, 3 stadium island.
// Usage: node victory-design.js <out.json>
const fs = require('fs');

const W = 96, H = 96;
const ground = Array.from({ length: H }, () => Array(W).fill('sea'));
const level = Array.from({ length: H }, () => Array(W).fill(0));
const at = (x, z) => x >= 0 && z >= 0 && x < W && z < H;
const paint = (test, g, l) => { for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) if (test(x + 0.5, z + 0.5)) { if (g) ground[z][x] = g; if (l !== undefined) level[z][x] = l; } };
const ellipse = (cx, cz, rx, rz) => (x, z) => ((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2 <= 1;
const circle = (cx, cz, r) => ellipse(cx, cz, r, r);
const rect = (x0, z0, x1, z1) => (x, z) => x >= x0 && x < x1 && z >= z0 && z < z1;
const or = (...f) => (x, z) => f.some((g) => g(x, z));
const and = (...f) => (x, z) => f.every((g) => g(x, z));
const not = (f) => (x, z) => !f(x, z);
// a path along a polyline, `width` tiles wide (3 painted tiles draw as about 2 once edge tiles are counted)
const path = (pts, width = 3) => (x, z) => {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
    if (Math.hypot(x - ax - t * dx, z - az - t * dz) <= width / 2) return true;
  }
  return false;
};
const onLevel = (l) => (x, z) => at(Math.floor(x), Math.floor(z)) && level[Math.floor(z)][Math.floor(x)] === l && ground[Math.floor(z)][Math.floor(x)] !== 'sea';

// ---------------- islands ----------------
// main island: three lobes (garden west, plaza middle, lighthouse east) with a straight south shore for the boardwalk
const mainLand = and(or(ellipse(50, 64, 33, 15), ellipse(25, 63, 14, 13), ellipse(73, 60, 15, 12), circle(86, 58, 5), rect(28, 68, 84, 80)), (x, z) => z < 80);
paint(mainLand, 'grass', 1);
// beach below the garden, one level down
paint(and(or(ellipse(22, 80, 16, 9), ellipse(14, 72, 8, 8)), not(mainLand)), 'beach', 0);
// Battle Dome island, raised
const domeIsland = ellipse(27, 25, 13, 11);
paint(domeIsland, 'grass', 2);
// stadium island, highest: wide north, tapering south
const stadiumIsland = or(ellipse(72, 22, 15, 15), ellipse(71, 38, 9, 9));
paint(stadiumIsland, 'grass', 3);
// daycare and statue islets
const daycare = circle(9, 53, 6), statueIslet = circle(49, 41, 4);
paint(daycare, 'grass', 1);
paint(statueIslet, 'grass', 1);

// ---------------- paths and plazas (paved), on each island's own level ----------------
const pave = (f, l) => paint(and(f, onLevel(l)), 'pave');
// main island
const plaza = circle(50, 65, 7.5);
pave(plaza, 1);
pave(path([[50, 57], [50, 52]]), 1);                                  // north to the dome bridge stairs? (see dome bridge)
pave(path([[43, 65], [34, 65], [24, 62]]), 1);                         // west to the garden
pave(path([[57, 64], [68, 58], [78, 57], [86, 58]]), 1);               // east to the lighthouse
pave(path([[50, 72], [50, 77]]), 1);                                   // south to the promenade
pave(path([[24, 55], [24, 51]]), 1);                                   // garden north to the Battle Dome bridge
pave(path([[69, 57], [69, 50]]), 1);                                   // north to the stadium bridge stairs
pave(rect(30, 77, 82, 80), 1);                                         // shop promenade along the boardwalk
pave(path([[14, 54], [18, 58]]), 1);                                   // daycare bridge landing
// garden: loop path and cross paths
pave(or(and(circle(25, 63, 7.5), not(circle(25, 63, 5))), path([[25, 56], [25, 70]]), path([[18, 63], [32, 63]])), 1);
pave(path([[25, 70], [30, 77]]), 1);
// flower beds in the four garden quarters and beside the fountain plaza
paint(and(or(rect(20, 58, 23, 61), rect(27, 58, 30, 61), rect(20, 65, 23, 68), rect(27, 65, 30, 68)), onLevel(1), (x, z) => ground[Math.floor(z)][Math.floor(x)] === 'grass'), 'flowers');
paint(and(or(rect(39, 57, 43, 60), rect(57, 57, 61, 60)), onLevel(1), (x, z) => ground[Math.floor(z)][Math.floor(x)] === 'grass'), 'flowers');
// Battle Dome island: plaza around the dome, paths to both bridges
pave(circle(27, 24, 6.5), 2);
pave(path([[27, 31], [26, 36]]), 2);
pave(path([[34, 25], [40, 25]]), 2);
// stadium island: forecourt, courtyard, breezeway south, path to the Trainer Hall
pave(rect(67, 27, 78, 29), 3);
pave(circle(72, 32, 4.5), 3);
pave(path([[72, 36], [72, 46]]), 3);
pave(path([[68, 33], [66, 36]]), 3);
pave(path([[58, 25], [64, 27]]), 3);
// Poke Ball plaza: red brick upper half around the fountain
paint(and(circle(50, 65, 5), (x, z) => z < 65), 'brick');
paint(circle(50, 65, 2), 'brick');

// ---------------- buildings (lots), named by role ----------------
const lots = [];
const lot = (role, cx, cz, w, d) => lots.push({ role, x0: Math.round(cx - w / 2), z0: Math.round(cz - d / 2), x1: Math.round(cx - w / 2) + w, z1: Math.round(cz - d / 2) + d, cx, cz, cells: w * d, base: 0, top: 0 });
lot('stadium', 72, 16, 15, 13);
lot('dome', 27, 23, 9, 8);
lot('hall', 65, 40, 5, 6);
lot('statue', 49, 41, 4, 4);
lot('lighthouse', 87, 58, 3, 3);
// shops facing the promenade, doors south
lot('ferris', 36, 73, 6, 6);
lot('theater', 44, 74, 5, 5);
lot('games', 57, 74, 5, 5);
lot('tutor', 64, 74, 5, 5);
lot('auction', 71, 73, 5, 5);
lot('mart', 78, 74, 5, 5);
// vine arches over the garden paths (bars along x span east-west paths)
for (const [cx, cz, w, d] of [[25, 57.5, 3, 1], [25, 68.5, 3, 1], [19.5, 63, 1, 3], [30.5, 63, 1, 3]]) lot('arch', cx, cz, w, d);
for (const l of lots) for (let z = l.z0; z < l.z1; z++) for (let x = l.x0; x < l.x1; x++) if (at(x, z) && l.role !== 'arch' && ground[z][x] === 'grass') ground[z][x] = 'grass';

// ---------------- decks: boardwalk, harbour pier, bridges ----------------
const decks = [];
const deck = (x0, z0, x1, z1, axis, lvl) => {
  const cellsList = []; for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) cellsList.push([x, z]);
  const [a0, a1] = axis === 'x' ? [x0, x1 - 1] : [z0, z1 - 1];
  decks.push({ x0, z0, x1, z1, cells: cellsList.length, cellsList, axis, level: lvl, ramp: false, base: 0, ends: [{ at: a0, level: lvl }, { at: a1, level: lvl }] });
};
deck(28, 80, 84, 83, 'x', 1);        // boardwalk along the south shore
deck(81, 83, 84, 92, 'z', 1);        // harbour pier
deck(24, 36, 27, 50, 'z', 2);        // Battle Dome island -> main island (stairs at the main end)
deck(40, 24, 59, 27, 'x', 3);        // Battle Dome island -> stadium island (stairs at the dome end)
deck(70, 46, 73, 50, 'z', 3);        // stadium island -> main island (two-level stairs at the main end)
deck(14, 52, 18, 55, 'x', 1);        // daycare islet -> main island

// ---------------- stairs (climbing toward dir) ----------------
const flight = (dir, x0, z0, x1, z1, lo, hi) => { const cells = []; for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) cells.push([x, z]); return { dir, cells, lo, hi }; };
const stairs = [
  flight('N', 24, 50, 27, 51, 1, 2),   // up from the garden onto the Battle Dome bridge
  flight('E', 39, 24, 40, 27, 2, 3),   // Battle Dome island up onto the stadium bridge
  flight('N', 70, 50, 73, 52, 1, 3),   // main island up onto the stadium bridge, two levels
  flight('E', 26, 80, 28, 83, 0, 1),   // beach up onto the boardwalk
];

// ---------------- railings and fences ----------------
const fences = [];
const fenceLine = (pts, type, lvl) => { for (const [x, z] of pts) if (at(x, z)) fences.push([x, z, type, lvl]); };
const run = (x0, z0, x1, z1) => { const out = []; for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) out.push([x, z]); return out; };
fenceLine(run(28, 82, 80, 82).filter(([x]) => x < 81 || x > 83), 'fence', 1); // boardwalk outer edge (gap where the pier starts)
fenceLine(run(84, 82, 84, 82), 'fence', 1);
fenceLine([...run(81, 84, 81, 91), ...run(83, 84, 83, 91)], 'fence', 1);       // pier sides
// daycare paddock: a ring of fence with a gate toward the bridge
for (let a = 0; a < 360; a += 4) { const x = Math.round(8 + Math.cos(a * Math.PI / 180) * 3.5), z = Math.round(53 + Math.sin(a * Math.PI / 180) * 3.5);
  if (!(x >= 11 && Math.abs(z - 53) <= 1)) fences.push([x, z, 'fence', 1]); }
// white railings around the fountain plaza rim and the stadium courtyard, with openings for the paths
for (let a = 0; a < 360; a += 3) {
  const x = Math.round(50 + Math.cos(a * Math.PI / 180) * 8.5), z = Math.round(65 + Math.sin(a * Math.PI / 180) * 8.5);
  const gap = [0, 90, 180, 270, 205].some((g) => Math.abs(((a - g + 540) % 360) - 180) > 180 - 16);
  if (!gap && ground[z]?.[x] === 'grass') fences.push([x, z, 'wall', 1]);
}
const fenceSeen = new Set(); const fencesOut = fences.filter(([x, z]) => { const k = x + ',' + z; if (fenceSeen.has(k)) return false; fenceSeen.add(k); return true; });

// ---------------- trees, beach things, ships, NPC spots ----------------
const trees = [];
const tree = (x, z) => { if (at(x, z) && ground[z][x] === 'grass') trees.push({ x0: x, z0: z, x1: x + 1, z1: z + 1, cx: x + 0.5, cz: z + 0.5 }); };
// a ring of trees just inside each island's coast, skipping paths, lots and bridge landings
const nearEdge = (x, z, l) => onLevel(l)(x + 0.5, z + 0.5) && [[2, 0], [-2, 0], [0, 2], [0, -2]].some(([dx, dz]) => !onLevel(l)(x + dx + 0.5, z + dz + 0.5));
const inLot = (x, z) => lots.some((l) => x >= l.x0 - 1 && x < l.x1 + 1 && z >= l.z0 - 1 && z < l.z1 + 1);
for (let z = 0; z < H; z += 2) for (let x = (z / 2) % 2; x < W; x += 2) {
  for (const l of [1, 2, 3]) if (nearEdge(x, z, l) && ground[z][x] === 'grass' && !inLot(x, z) && z < 76) tree(x, z);
}
// garden hedges of trees and clusters on the stadium island behind the dome
for (const [x, z] of [[62, 10], [64, 8], [80, 8], [82, 10], [60, 20], [84, 20], [62, 40], [80, 40], [40, 58], [58, 58], [40, 70], [62, 70]]) tree(x, z);
const parasols = [[16, 74], [22, 78], [14, 82], [24, 85]].map(([x, z]) => ({ cx: x, cz: z }));
const towels = [[18, 76], [20, 81], [17, 85]].map(([x, z]) => ({ cx: x + 0.5, cz: z + 0.5, x0: x, x1: x + 1, z0: z, z1: z + 2 }));
const ships = [{ x0: 86, z0: 80, x1: 91, z1: 94, cx: 88.5, cz: 87 }, { x0: 66, z0: 88, x1: 80, z1: 93, cx: 73, cz: 90.5 }];
const signs = [{ role: 'daycare', x: 8, z: 53 }, { role: 'event', x: 84.5, z: 86 }, { role: 'journeys', x: 80.5, z: 89 }];
// breezeway: an unnamed strip south of the courtyard (a zone for now; the glass walkway comes later)
lots.push({ role: null, x0: 71, z0: 37, x1: 74, z1: 45, cx: 72.5, cz: 41, cells: 24, base: 0, top: 0 });

fs.writeFileSync(process.argv[2], JSON.stringify({ source: 'victory-design', width: W, height: H, ground, level, surface: level,
  fences: fencesOut, stairs, lots, ships, decks, trees, parasols, towels, signs, fountain: [50.5, 65.5] }));
const hist = {}; ground.flat().forEach((g) => (hist[g] = (hist[g] || 0) + 1));
console.log('ground', JSON.stringify(hist), 'lots', lots.length, 'decks', decks.length, 'stairs', stairs.length, 'fences', fencesOut.length, 'trees', trees.length);
