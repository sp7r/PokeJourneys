'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { root, work, defaultMap, defaultLayout, skipList, options, modelFolder, markers, writeJson } = require('./pdsmap');

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(path.basename(command) + ' exited with ' + result.status);
}

function main() {
  const args = options({ data: path.join(work, 'godot-hub'), map: defaultMap, layout: defaultLayout, sprites: 'C:/Projects/Godot pokemon/game' });
  const data = path.resolve(args.data);
  const relative = path.relative(root, data);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('--data must be outside the repository');
  const layout = JSON.parse(fs.readFileSync(args.layout, 'utf8'));
  const placed = markers(args.map);
  const island = path.join(data, 'victory_island'), terrain = path.join(island, 'terrain'), build = path.join(data, '.build');
  fs.mkdirSync(build, { recursive: true });
  const javaHome = process.env.JAVA_HOME || 'C:/Program Files/Microsoft/jdk-17.0.20.101-hotspot';
  const lib = process.env.DSMS_LIB || path.join(work, 'dsms/app/Pokemon DS Map Studio-2.2/lib');
  const cp = ['Pokemon DS Map Studio-2.2.jar', 'jogamp-fat.jar', 'graphicslib3D.jar'].map(n => path.join(lib, n)).join(';');
  run(path.join(javaHome, 'bin/javac.exe'), ['-nowarn', '-cp', cp, '-d', build, path.join(root, 'tools/hub/dsms/ExportObj.java')]);
  const terrainRelative = path.relative(data, path.resolve(terrain));
  if (!terrainRelative || terrainRelative.startsWith('..') || path.isAbsolute(terrainRelative)) throw new Error('Terrain path escapes data directory');
  fs.rmSync(terrain, { recursive: true, force: true });
  fs.mkdirSync(terrain, { recursive: true });
  run(path.join(javaHome, 'bin/java.exe'), ['-Djava.awt.headless=true', '-cp', cp + ';' + build, 'ExportObj', path.join(args.map, 'VictoryIsland.pdsmap'), path.join(terrain, 'island.obj'), skipList(args.map) || '-1', path.join(island, 'cells.json')]);
  const cells = JSON.parse(fs.readFileSync(path.join(island, 'cells.json'), 'utf8'));
  const { cols, rows } = cells;
  if (cols % 32 || rows % 32) throw new Error('Expected whole 32x32 maps, got ' + cols + 'x' + rows);
  const behaviour = Array.from({ length: rows }, () => Array(cols));
  for (let Y = 0; Y < rows / 32; Y++) for (let X = 0; X < cols / 32; X++) {
    const file = path.join(args.map, `VictoryIsland_${String(X).padStart(2, '0')}_${String(Y).padStart(2, '0')}.per`);
    const bytes = fs.readFileSync(file);
    if (bytes.length !== 2048) throw new Error('Expected 2048 bytes: ' + file);
    for (let row = 0; row < 32; row++) for (let col = 0; col < 32; col++) {
      const x = X * 32 + col, y = Y * 32 + row, offset = (row * 32 + col) * 2;
      const b = bytes[offset], blocked = bytes[offset + 1] & 0x80, tile = cells.tiles[y][x];
      behaviour[y][x] = tile >= 1234 && tile <= 1241 ? 'stairs' : blocked && b === 0x15 ? 'water' : blocked ? 'block' : b === 0x73 ? 'bridge' : 'walk';
    }
  }
  for (const p of placed) for (let y = Math.max(0, p.north); y < Math.min(rows, p.south); y++) for (let x = Math.max(0, p.west); x < Math.min(cols, p.east); x++) {
    if (behaviour[y][x] === 'block') behaviour[y][x] = 'walk';
  }
  writeJson(path.join(island, 'collision.json'), { cols, rows, behaviour });
  const models = path.join(island, 'models');
  fs.mkdirSync(models, { recursive: true });
  let modelCount = 0;
  for (const name of new Set([...layout.buildings, ...layout.props].map(m => m.model))) {
    if (path.basename(name) !== name || name === '.' || name === '..') throw new Error('Invalid model name: ' + name);
    const source = modelFolder(name);
    if (!source) { console.warn('Missing model: ' + name); continue; }
    fs.cpSync(source, path.join(models, name), { recursive: true, filter: file => !/\.(log|json)$/i.test(file) });
    modelCount++;
  }
  const spriteDir = path.join(data, 'sprites');
  fs.mkdirSync(spriteDir, { recursive: true });
  let spriteCount = 0;
  for (const entry of fs.readdirSync(path.join(args.sprites, 'sprites'), { withFileTypes: true })) {
    if (!entry.isFile() || !/\.png$/i.test(entry.name)) continue;
    fs.copyFileSync(path.join(args.sprites, 'sprites', entry.name), path.join(spriteDir, entry.name)); spriteCount++;
  }
  function rewrite(value) {
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === 'sheet' && typeof v === 'string' ? v.replace(/^res:\/\/sprites\//, 'sprites/') : rewrite(v)]));
    return value;
  }
  writeJson(path.join(data, 'sprites.json'), rewrite(JSON.parse(fs.readFileSync(path.join(args.sprites, 'data/sprites.json'), 'utf8'))));
  writeJson(path.join(island, 'info.json'), { built: new Date().toISOString(), map: path.resolve(args.map), layout: path.resolve(args.layout) });
  const counts = {};
  for (const row of behaviour) for (const b of row) counts[b] = (counts[b] || 0) + 1;
  console.log('Cells per behaviour: ' + JSON.stringify(counts));
  console.log(`Models copied: ${modelCount}; sprites copied: ${spriteCount}`);
}
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
