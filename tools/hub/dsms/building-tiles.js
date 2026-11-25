// Puts the hub's buildings into a DS Map Studio map as model tiles at native size (1:1, 16 DS units per tile), so they
// can be seen and moved in the editor. Converts each building and landmark model of the Godot layout (glb-to-obj.js),
// appends the tiles to the map's tileset once (TileImport) and places one tile per entry on its spot, on the map's top
// layer at the entry's level. model-tile-index.txt records each tile's model, footprint and where the model's origin
// sits inside the tile, so hub/godot/pipeline/build-data.js reads the placements back after hand edits.
// Run on a freshly generated map (victory-map.js); placing again moves every building tile back to the layout's spot.
// Usage: node building-tiles.js <mapDir> <godot-layout.json>
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { convert } = require('./glb-to-obj.js');

const [MAP, LAYOUT] = process.argv.slice(2);
const WORK = process.env.DSMS_WORK || 'C:/Projects/hub-work/dsms';
const HUB = path.dirname(WORK);
const LIB = process.env.DSMS_LIB || path.join(WORK, 'app/Pokemon DS Map Studio-2.2/lib');
const JAVA = path.join(process.env.JAVA_HOME || 'C:/Program Files/Microsoft/jdk-17.0.20.101-hotspot', 'bin/java');
const CP = ['Pokemon DS Map Studio-2.2.jar', 'jogamp-fat.jar', 'graphicslib3D.jar'].map((n) => path.join(LIB, n)).concat(path.join(WORK, 'tools-build')).join(path.delimiter);
const FOLDERS = ['buildings-glb', 'houses-glb', 'decor-glb', 'props-glb', 'pwt-glb', 'pokeathlon-glb', 'gen4-glb/hg2', 'gen4-glb/hg', 'gen4-glb/pt', 'gen4-glb/dome', 'stadium-glb'];
const LAYER = 7; // top tile layer: free in maps from victory-map.js

const layout = JSON.parse(fs.readFileSync(LAYOUT, 'utf8'));
const entries = [...layout.buildings, ...layout.props.filter((p) => p.tile)];
const lines = fs.readFileSync(path.join(MAP, 'VictoryIsland.pdsmap'), 'utf8').split(/\r?\n/);
const tileset = lines[lines.indexOf('tileset') + 1].trim();
const indexFile = path.join(MAP, 'model-tile-index.txt');

// ---- tiles: convert and import the models not in the tileset yet ----
const index = new Map(); // model -> { id, w, h, ox, oy, bounds }
if (fs.existsSync(indexFile)) for (const l of fs.readFileSync(indexFile, 'utf8').split(/\r?\n/)) {
  const m = l.match(/^(\d+)\t([^\t]+)\.obj\t(\d+)x(\d+)\t([-\d.,]+)$/);
  if (m) { const [ox, oy, ...bounds] = m[5].split(',').map(Number); index.set(m[2], { id: +m[1], w: +m[3], h: +m[4], ox, oy, bounds }); }
}
const missing = [...new Set(entries.map((e) => e.model))].filter((n) => !index.has(n));
if (missing.length) {
  const list = [], info = {};
  for (const name of missing) {
    const glb = FOLDERS.map((f) => path.join(HUB, f, name, name + '.glb')).find((f) => fs.existsSync(f));
    if (!glb) { console.warn('no model for ' + name); continue; }
    const dir = path.join(WORK, 'model-tiles-1to1', name);
    const r = convert(glb, dir, name, 1, 16); // 16 DS units to a tile: native size
    const [minX, minY, maxX, maxY] = r.bounds;
    info[name] = { w: r.w, h: r.h, ox: (r.w - (maxX - minX)) / 2 - minX, oy: (r.h - (maxY - minY)) / 2 - minY, bounds: r.bounds };
    list.push([dir.split(path.sep).join('/'), name + '.obj', r.w, r.h].join('\t'));
  }
  const listFile = path.join(WORK, 'model-tiles-1to1', 'import-list.txt');
  fs.writeFileSync(listFile, list.join('\n') + '\n');
  const ts = path.join(MAP, tileset);
  fs.copyFileSync(ts, ts + '.before-buildings');
  const out = spawnSync(JAVA, ['-Djava.awt.headless=true', '-cp', CP, 'TileImport', ts, ts, listFile], { encoding: 'utf8' });
  if (out.status !== 0) throw new Error('TileImport failed\n' + out.stderr);
  const added = [];
  for (const l of out.stdout.split(/\r?\n/)) {
    const m = l.match(/^(\d+)\t([^\t]+)\.obj\t(\d+)x(\d+)$/);
    if (!m) continue;
    const i = info[m[2]];
    index.set(m[2], { id: +m[1], ...i });
    added.push(`${m[1]}\t${m[2]}.obj\t${i.w}x${i.h}\t${[i.ox, i.oy, ...i.bounds].map((v) => +v.toFixed(4)).join(',')}`);
  }
  fs.appendFileSync(indexFile, added.join('\n') + '\n');
  console.log(`imported ${added.length} model tiles into ${tileset}`);
}

// ---- placements: clear old building tiles, then one tile per entry ----
const ids = new Set([...index.values()].map((t) => t.id));
const maps = []; // { x, y, tg: [line of each tilegrid header], hg: [...] }
for (let i = 0; i < lines.length; i++) {
  if (lines[i] === 'mapstart') { const [x, y] = lines[i + 1].trim().split(/\s+/).map(Number); maps.push({ x, y, tg: [], hg: [] }); }
  else if (lines[i] === 'tilegrid') maps[maps.length - 1].tg.push(i);
  else if (lines[i] === 'heightgrid') maps[maps.length - 1].hg.push(i);
}
const grid = (m, header, a) => lines[header + 1 + a].trim().split(/\s+/).map(Number);
const setRow = (m, header, a, row) => { lines[header + 1 + a] = row.join(' ') + ' '; };
for (const m of maps) for (let l = 0; l < 8; l++) for (let a = 0; a < 32; a++) {
  const row = grid(m, m.tg[l], a);
  if (row.some((t) => ids.has(t))) setRow(m, m.tg[l], a, row.map((t) => (ids.has(t) ? -1 : t)));
}
let placed = 0;
for (const e of entries) {
  const t = index.get(e.model); if (!t) continue;
  const x = Math.round(e.x - t.ox), ys = Math.round(e.y + t.oy - 1); // tile anchor: its south-west cell; the tile grows north
  const m = maps.find((q) => q.x === Math.floor(x / 32) && q.y === Math.floor(ys / 32));
  if (!m) { console.warn(`${e.id} is outside the map`); continue; }
  const a = 31 - (ys % 32), b = x % 32;
  const tr = grid(m, m.tg[LAYER], a), hr = grid(m, m.hg[LAYER], a);
  tr[b] = t.id; hr[b] = e.level ?? 1;
  setRow(m, m.tg[LAYER], a, tr); setRow(m, m.hg[LAYER], a, hr);
  placed++;
}
const pdsmap = path.join(MAP, 'VictoryIsland.pdsmap');
fs.copyFileSync(pdsmap, pdsmap + '.before-buildings');
fs.writeFileSync(pdsmap, lines.join('\n'));
console.log(`placed ${placed} building tiles`);
