'use strict';
const fs = require('fs');
const path = require('path');
const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const round = n => Math.round(n * 1000) / 1000;
const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);

// Mesh vertices use Godot world coordinates; tile centers are (x - 15.5, y - 15.5).
// They must be the native geometry before the renderer's small material depth bias.
function meshIndex(surfaces) {
  const bins = new Map();
  for (const surface of surfaces) {
    const vertices = surface.vertices, indices = surface.indices?.length ? surface.indices : null;
    const count = indices ? indices.length : vertices.length;
    for (let i = 0; i + 2 < count; i += 3) {
      const [a, b, c] = [0, 1, 2].map(k => vertices[indices ? indices[i + k] : i + k]);
      const e1 = sub(b, a), e2 = sub(c, a);
      const triangle = { a, b, c, e1, e2, name: surface.name || '', det: e1[0] * e2[2] - e1[2] * e2[0] };
      const x0 = Math.floor(Math.min(a[0], b[0], c[0]) + 15.5), x1 = Math.floor(Math.max(a[0], b[0], c[0]) + 15.5);
      const y0 = Math.floor(Math.min(a[2], b[2], c[2]) + 15.5), y1 = Math.floor(Math.max(a[2], b[2], c[2]) + 15.5);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const key = `${x},${y}`;
        if (!bins.has(key)) bins.set(key, []);
        bins.get(key).push(triangle);
      }
    }
  }
  return bins;
}

function sampleFloor(index, x, y) {
  let best = null;
  for (const t of index.get(`${Math.floor(x)},${Math.floor(y)}`) || []) {
    if (Math.abs(t.det) < 1e-8) continue;
    const xx = x - 15.5 - t.a[0], yy = y - 15.5 - t.a[2];
    const u = (xx * t.e2[2] - yy * t.e2[0]) / t.det;
    const v = (yy * t.e1[0] - xx * t.e1[2]) / t.det;
    if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
    const height = t.a[1] + u * t.e1[1] + v * t.e2[1];
    if (best === null || height > best.height) {
      const slopeX = (t.e1[1] * t.e2[2] - t.e2[1] * t.e1[2]) / t.det;
      const slopeY = (t.e2[1] * t.e1[0] - t.e1[1] * t.e2[0]) / t.det;
      best = { height, name: t.name, slope: Math.hypot(slopeX, slopeY) };
    }
  }
  return best;
}

function segmentBlocked(index, start, end) {
  const d = sub(end, start);
  const candidates = new Set([
    ...(index.get(`${Math.floor(start[0] + 15.5)},${Math.floor(start[2] + 15.5)}`) || []),
    ...(index.get(`${Math.floor(end[0] + 15.5)},${Math.floor(end[2] + 15.5)}`) || [])
  ]);
  for (const t of candidates) {
    // The flower petals and their planter are decorative, as in the reference walk grid.
    if (/poke_c_flower/i.test(t.name)) continue;
    const h = cross(d, t.e2), det = dot(t.e1, h);
    if (Math.abs(det) < 1e-8) continue;
    const f = 1 / det, s = sub(start, t.a), u = f * dot(s, h);
    if (u < 0 || u > 1) continue;
    const q = cross(s, t.e1), v = f * dot(d, q);
    if (v < 0 || u + v > 1) continue;
    const distance = f * dot(t.e2, q);
    if (distance >= 0 && distance <= 1) return true;
  }
  return false;
}

function samplePlate(plates, x, y) {
  let best = null;
  for (const p of plates) {
    const lx = x - p.map[0] * 32 + 0.5, ly = y - p.map[1] * 32 + 0.5;
    if (lx < p.x || lx >= p.x + p.w || ly < p.y || ly >= p.y + p.h) continue;
    const v = p.v, a = [v[0], -v[1], v[2]], b = [v[3], -v[4], v[5]], c = [v[6], -v[7], v[8]];
    const det = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(det) < 1e-8) continue;
    const u = ((lx - a[0]) * (c[1] - a[1]) - (ly - a[1]) * (c[0] - a[0])) / det;
    const v2 = ((ly - a[1]) * (b[0] - a[0]) - (lx - a[0]) * (b[1] - a[1])) / det;
    const height = a[2] + u * (b[2] - a[2]) + v2 * (c[2] - a[2]);
    if (best === null || height > best.height) best = { height, type: p.type };
  }
  return best;
}

function buildWalk({ plates, cells, meshes, mapFile, layout, reference, treeTiles = [] }) {
  const { cols, rows } = cells;
  // layout.json collision lists: "notFloor" names models in the terrain group that are buildings or
  // roofs (they still block, but are never stood on); "cliffs" names sloped surfaces that are walls.
  const fixes = layout.collision || {};
  const matches = list => name => (list || []).some(part => name.toLowerCase().includes(part.toLowerCase()));
  const notFloor = matches(fixes.notFloor), cliff = matches(fixes.cliffs);
  const terrain = meshIndex((meshes.terrain || []).filter(s => !notFloor(s.name || '')));
  const body = meshIndex(Object.values(meshes).flat());
  const heights = Array.from({ length: rows }, () => Array(cols).fill(0));
  const types = Array.from({ length: rows }, () => Array(cols).fill('#'));
  const connections = Array.from({ length: rows }, () => Array(cols).fill(0));
  const diagnostics = { missingHeight: [], plateMeshDifferences: [], staleHeightCorrections: [], unknownBehaviours: {}, counts: {} };
  const stem = path.basename(mapFile, path.extname(mapFile));
  for (let my = 0; my < rows / 32; my++) for (let mx = 0; mx < cols / 32; mx++) {
    const file = path.join(path.dirname(mapFile), `${stem}_${String(mx).padStart(2, '0')}_${String(my).padStart(2, '0')}.per`);
    const bytes = fs.readFileSync(file);
    if (bytes.length !== 2048) throw new Error(`Expected 2048 collision bytes in ${file}`);
    const localPlates = plates.filter(p => p.map[0] === mx && p.map[1] === my);
    for (let cy = 0; cy < 32; cy++) for (let cx = 0; cx < 32; cx++) {
      const x = mx * 32 + cx, y = my * 32 + cy, offset = (cy * 32 + cx) * 2;
      const behaviour = bytes[offset], blocked = Boolean(bytes[offset + 1] & 0x80);
      const floor = sampleFloor(terrain, x, y), plate = samplePlate(localPlates, x, y);
      if (!floor && !plate) diagnostics.missingHeight.push([x, y]);
      if (floor && plate && Math.abs(floor.height - plate.height) > 0.02) diagnostics.plateMeshDifferences.push({ tile: [x, y], plate: round(plate.height), mesh: round(floor.height) });
      const stalePlate = floor && plate && Math.abs(floor.height - plate.height) > 0.02;
      // A moved terrain stair can leave an older height plate behind in the editor's sidecar.
      // Keep the visible native terrain and movement together, and report every correction.
      heights[y][x] = round(stalePlate ? floor.height : plate?.height ?? floor?.height ?? cells.heights[y][x]);
      if (stalePlate) diagnostics.staleHeightCorrections.push({ tile: [x, y], plate: round(plate.height), terrain: round(floor.height), blocked });
      // A boardwalk built out over the sea keeps the sea's collision in the map; walk on it as a bridge.
      const deck = blocked && behaviour === 0x15 && /hashi|bridge/i.test(floor?.name || '') && floor.height > 0;
      let type = deck ? '=' : blocked ? behaviour === 0x15 ? '~' : '#' : behaviour === 0x73 || /hashi|bridge/i.test(floor?.name || '') ? '=' : '.';
      if (!blocked && (stalePlate ? floor.slope > 0.1 : plate && plate.type >= 2)) type = 'S';
      // A sloped cliff face is a wall, even where the map's stair plate reaches over it.
      if (floor && floor.slope > 0.1 && cliff(floor.name)) type = '#';
      types[y][x] = type;
      if (![0, 0x15, 0x73].includes(behaviour)) diagnostics.unknownBehaviours[`0x${behaviour.toString(16)}`] = (diagnostics.unknownBehaviours[`0x${behaviour.toString(16)}`] || 0) + 1;
      diagnostics.counts[type] = (diagnostics.counts[type] || 0) + 1;
    }
  }
  // Hand fixes from layout.json for collision the map's .per files get wrong:
  // "open" tiles take the walk type of a walkable neighbour, "block" tiles become walls.
  // An entry is [x, y], or [x, y, lastX] for a run of tiles along one row.
  // Opening comes first so that props standing in an opened run still block; "block" comes last.
  const tiles = list => (list || []).flatMap(([x, y, last = x]) => Array.from({ length: last - x + 1 }, (_, i) => [x + i, y]));
  for (const [x, y] of tiles(fixes.open)) {
    const near = DIRS.map(([dx, dy]) => types[y + dy]?.[x + dx]).find(t => t === '.' || t === '=');
    types[y][x] = near || '.';
  }
  // Models standing on a walkable tile at body height block it, since the map's collision
  // often misses props. Names in "passThrough" (overhead arches, flowers, shadows, stairs) never
  // block; "posts" (lamp posts, parasols, bunting poles) block only the tile their foot is on.
  // Trees block the 2 x 2 tiles their map tile covers. Doorway tiles always stay open.
  const passThrough = matches([...(fixes.passThrough || []), 'kage', 'shadow', 'shade', 'PT_004_pc_01', 'newstep', 'stair', 'kaidan']);
  const post = matches(fixes.posts), canopy = matches(fixes.canopies);
  const tree = name => /^ki0[0-9]/.test(name);
  const props = [...(meshes.buildings || []), ...(meshes.decorations || []), ...(meshes.terrain || []).filter(s => notFloor(s.name || ''))];
  const solid = Array.from({ length: rows }, () => Array(cols).fill(false));
  const feet = [];
  for (const s of props) {
    const name = s.name || '';
    if (passThrough(name) || tree(name)) continue;
    const v = s.vertices, idx = s.indices?.length ? s.indices : null, n = idx ? idx.length : v.length;
    for (let i = 0; i + 2 < n; i += 3) {
      const t = [0, 1, 2].map(k => v[idx ? idx[i + k] : i + k]);
      // "canopies" (parasols) also block the ground under them up to head height, since a canopy
      // lower than the hero's sprite would cut through its head.
      if (canopy(name)) {
        const xs = t.map(p => p[0] + 15.5), zs = t.map(p => p[2] + 15.5), ys = t.map(p => p[1]);
        for (let y = Math.max(0, Math.ceil(Math.min(...zs) - 0.25)); y <= Math.min(rows - 1, Math.floor(Math.max(...zs) + 0.25)); y++)
          for (let x = Math.max(0, Math.ceil(Math.min(...xs) - 0.25)); x <= Math.min(cols - 1, Math.floor(Math.max(...xs) + 0.25)); x++)
            if (Math.min(...ys) < heights[y][x] + 3.2) solid[y][x] = true;
      }
      if (post(name)) {
        // Collect the pole's foot; each pole blocks the one tile under the middle of its foot.
        for (const p of t) {
          const fx = Math.round(p[0] + 15.5), fz = Math.round(p[2] + 15.5);
          if (heights[fz] && fx >= 0 && fx < cols && p[1] - heights[fz][fx] < 0.3) feet.push([p[0] + 15.5, p[2] + 15.5]);
        }
        continue;
      }
      // Tiles whose middle (+-0.25 around the center) the triangle's footprint covers.
      const xs = t.map(p => p[0] + 15.5), zs = t.map(p => p[2] + 15.5), ys = t.map(p => p[1]);
      for (let y = Math.max(0, Math.ceil(Math.min(...zs) - 0.25)); y <= Math.min(rows - 1, Math.floor(Math.max(...zs) + 0.25)); y++)
        for (let x = Math.max(0, Math.ceil(Math.min(...xs) - 0.25)); x <= Math.min(cols - 1, Math.floor(Math.max(...xs) + 0.25)); x++) {
          const f = heights[y][x];
          if (Math.min(...ys) < f + 1.4 && Math.max(...ys) > f + 0.3) solid[y][x] = true;
        }
    }
  }
  const poles = [];
  for (const [x, z] of feet) {
    const p = poles.find(c => Math.hypot(c.x / c.n - x, c.z / c.n - z) < 0.8);
    if (p) { p.x += x; p.z += z; p.n++; } else poles.push({ x, z, n: 1 });
  }
  for (const p of poles) { const x = Math.round(p.x / p.n), y = Math.round(p.z / p.n); if (solid[y] && x >= 0 && x < cols) solid[y][x] = true; }
  for (const { x0, y0, x1, y1 } of treeTiles) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (solid[y]) solid[y][x] = true;
  for (const d of layout.doorways || []) if (solid[d.tile[1]]) solid[d.tile[1]][d.tile[0]] = false;
  // "clear" tiles are opened like "open" ones and are never blocked by props.
  for (const [x, y] of tiles(fixes.clear)) {
    solid[y][x] = false;
    if ('#'.includes(types[y][x])) types[y][x] = DIRS.map(([dx, dy]) => types[y + dy]?.[x + dx]).find(t => t === '.' || t === '=') || '.';
  }
  diagnostics.propBlocked = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++)
    if (solid[y][x] && '.=S'.includes(types[y][x])) { types[y][x] = '#'; diagnostics.propBlocked.push([x, y]); }
  for (const [x, y] of tiles(fixes.block)) types[y][x] = '#';
  const stepHeights = {};
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if ('#~'.includes(types[y][x])) continue;
    // Only east and south are evaluated; every accepted edge is symmetric.
    for (const direction of [1, 3]) {
      const [dx, dy] = DIRS[direction], xx = x + dx, yy = y + dy;
      if (xx >= cols || yy >= rows || '#~'.includes(types[yy][xx])) continue;
      const h0 = heights[y][x], h1 = heights[yy][xx];
      const profile = [0.25, 0.5, 0.75].map(t => round(sampleFloor(terrain, x + dx * t, y + dy * t)?.height ?? h0 + (h1 - h0) * t));
      const all = [h0, ...profile, h1];
      if (Math.abs(h0 - h1) > 1.01 || all.slice(1).some((h, i) => Math.abs(h - all[i]) > 0.76)) continue;
      const base = Math.max(...all);
      let blocked = false;
      for (const height of [0.3, 0.7]) for (const lateral of [-0.15, 0, 0.15]) {
        const start = [x - 15.5 + dy * lateral, base + height, y - 15.5 + dx * lateral];
        const end = [xx - 15.5 + dy * lateral, base + height, yy - 15.5 + dx * lateral];
        if (segmentBlocked(body, start, end)) blocked = true;
      }
      if (blocked) continue;
      const opposite = direction === 1 ? 0 : 2;
      connections[y][x] |= 1 << direction;
      connections[yy][xx] |= 1 << opposite;
      if (types[y][x] === 'S' || types[yy][xx] === 'S' || Math.abs(h0 - h1) > 0.05) {
        stepHeights[`${x},${y},${direction}`] = profile;
        stepHeights[`${xx},${yy},${opposite}`] = [...profile].reverse();
      }
    }
  }
  const spawn = Array.isArray(layout.spawn) ? layout.spawn : layout.spawn.tile;
  const walk = { cols, rows, spawn, heights, types: types.map(row => row.join('')), connections, stepHeights };
  if (reference) {
    diagnostics.referenceDifferences = { heights: [], types: [], connections: [], stepHeights: [] };
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (Math.abs(reference.heights[y][x] - heights[y][x]) > 0.01) diagnostics.referenceDifferences.heights.push([x, y]);
      if (reference.types[y][x] !== types[y][x]) diagnostics.referenceDifferences.types.push([x, y, reference.types[y][x], types[y][x]]);
      if (reference.connections[y][x] !== connections[y][x]) diagnostics.referenceDifferences.connections.push([x, y, reference.connections[y][x], connections[y][x]]);
    }
    for (const key of new Set([...Object.keys(reference.stepHeights), ...Object.keys(stepHeights)])) {
      const a = reference.stepHeights[key], b = stepHeights[key];
      if (!a || !b || a.some((v, i) => Math.abs(v - b[i]) > 0.002)) diagnostics.referenceDifferences.stepHeights.push(key);
    }
  }
  return { walk, diagnostics };
}
module.exports = { buildWalk, meshIndex, sampleFloor, samplePlate };


