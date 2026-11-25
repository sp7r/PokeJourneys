'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../..');
const work = 'C:/Projects/hub-work';
const defaultMap = path.join(work, 'dsms/victory-island-1to1');
const defaultLayout = path.join(root, 'hub/godot/data/victory_island.json');
// model tiles listed in the map's model-tile-index.txt are buildings and props placed as separate models in the hub;
// the flat Pokeathlon track pieces and the Poke Ball plaza are ground and stay in the terrain
const ground = name => /^track_|^pokeball_plaza$/.test(name);
function modelIndex(map) {
  const index = new Map(), file = path.join(map, 'model-tile-index.txt');
  if (!fs.existsSync(file)) return index;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^(\d+)\t([^\t]+)\.obj\t(\d+)x(\d+)(?:\t.*)?$/);
    if (m && !ground(m[2])) index.set(+m[1], { name: m[2], w: +m[3], h: +m[4] });
  }
  return index;
}
// ExportObj's skip list: every building tile of the map
const skipList = map => [...modelIndex(map).keys()].join(',');
const folders = ['buildings-glb', 'houses-glb', 'decor-glb', 'props-glb', 'pwt-glb', 'pokeathlon-glb', 'gen4-glb/hg2', 'gen4-glb/hg', 'gen4-glb/pt', 'gen4-glb/dome', 'stadium-glb'];

function options(defaults) {
  const result = { ...defaults };
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i].replace(/^--/, '');
    if (!process.argv[i].startsWith('--') || !(key in defaults)) throw new Error('Unknown option: ' + process.argv[i]);
    if (typeof defaults[key] === 'boolean') result[key] = true;
    else {
      if (!process.argv[i + 1] || process.argv[i + 1].startsWith('--')) throw new Error('Missing value for --' + key);
      result[key] = path.resolve(process.argv[++i]);
    }
  }
  return result;
}

function modelFolder(name) {
  return folders.map(folder => path.join(work, folder, name)).find(folder => fs.existsSync(path.join(folder, name + '.glb')));
}

// building tiles placed in the map: model name, footprint and level of each
function markers(map) {
  const index = modelIndex(map);
  if (!index.size) return []; // maps without model tiles
  const lines = fs.readFileSync(path.join(map, 'VictoryIsland.pdsmap'), 'utf8').split(/\r?\n/).map(s => s.trim());
  const placed = [];
  let current;
  for (let i = 0; i < lines.length; i++) {
    const token = lines[i];
    if (token === 'mapstart') {
      const [x, y] = lines[++i].split(/\s+/).map(Number);
      current = { x, y, tiles: [], heights: [] };
    } else if (token === 'tilegrid' || token === 'heightgrid') {
      if (!current) throw new Error('Grid outside map');
      const grid = [];
      for (let a = 0; a < 32; a++) {
        const row = (lines[++i] || '').split(/\s+/).map(Number);
        if (row.length !== 32 || row.some(n => !Number.isInteger(n))) throw new Error('Invalid grid row at line ' + (i + 1));
        grid.push(row);
      }
      current[token === 'tilegrid' ? 'tiles' : 'heights'].push(grid);
    } else if (token === 'mapend') {
      if (!current || current.tiles.length !== 8 || current.heights.length !== 8) throw new Error('Expected eight tile and height layers');
      current.tiles.forEach((grid, layer) => grid.forEach((row, a) => row.forEach((id, b) => {
        const entry = index.get(id);
        if (!entry) return;
        const x = current.x * 32 + b, y = current.y * 32 + 31 - a;
        placed.push({ ...entry, tile: id, level: current.heights[layer][a][b], west: x, east: x + entry.w, north: y - entry.h + 1, south: y + 1 });
      })));
      current = null;
    }
  }
  if (current) throw new Error('Unterminated map');
  return placed;
}

const round = n => Math.round(n * 100) / 100;
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}
module.exports = { root, work, defaultMap, defaultLayout, skipList, options, modelFolder, markers, round, writeJson };
