'use strict';
// Finds the original games' animation frames for the hub's textures.
// 1. Lists every texture file in the ROM extractions that holds numbered frames (name.1, name.2 ...).
// 2. Converts each one to PNGs with apicula (cached in <data>/.build/frames-src).
// 3. Runs frames-match.js, which also builds sprite sheets for layout.json's NPCs, and matches each hub texture to a frame by shape, recolours the whole set to
//    the hub texture's palette and writes <data>/frames/ plus <data>/frames.json.
// Usage: node tools/hub/victory/frames.js [--data dir] [--extracts dir,dir] [--apicula exe] [--sets file]
// --sets: a JSON list of the frame sets to look at ("hg-extract__hamabe_1", as frames.json names its sources), so a
// build that knows which sets the hub uses (the phone's, tools/hub/build/frame-sets.json) converts only those.
const fs = require('fs'), path = require('path');
const { spawnSync } = require('child_process');

const out = {
  data: 'C:/Projects/hub-work/victory-island-data',
  extracts: ['C:/Projects/hub-work/hg-extract', 'C:/Projects/hub-work/pt-extract', 'C:/Projects/hub-work/b2-extract'].join(','),
  apicula: process.env.APICULA || 'C:/Projects/Godot pokemon/tools/apicula/apicula.exe', sets: ''
};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i].replace(/^--/, '');
  if (!(key in out) || !process.argv[i + 1]) throw Error('Unknown or incomplete option: ' + process.argv[i]);
  out[key] = process.argv[++i];
}
const run = (exe, args) => spawnSync(exe, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
const build = path.join(out.data, '.build'), sources = path.join(build, 'frames-src');
fs.mkdirSync(sources, { recursive: true });

// Step 1: frame set list, cached by file size and time.
const listFile = path.join(build, 'framesets.json');
const cache = fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile)) : {};
const sets = [];
for (const dir of out.extracts.split(',')) {
  const only = out.sets ? new Set(JSON.parse(fs.readFileSync(out.sets, 'utf8'))) : null;
  for (const name of fs.readdirSync(dir).filter(n => n.toLowerCase().endsWith('.nsbtx') && (!only || only.has(path.basename(dir) + '__' + n.slice(0, -6))))) {
    const file = path.join(dir, name), st = fs.statSync(file), key = file + '|' + st.size + '|' + st.mtimeMs;
    if (!(key in cache)) {
      const info = run(out.apicula, ['info', file]).stdout || '';
      // Frame names as the game gives them ("hana01.1"); apicula writes them as "hana01_1.png".
      const names = (info.match(/Name: "[^"]+\.\d+"/g) || []).map(m => m.slice(7, -1));
      cache[key] = names.length >= 2 ? names : false;
    }
    if (cache[key] === true) delete cache[key];
    else if (cache[key]) sets.push([file, cache[key]]);
  }
}
fs.writeFileSync(listFile, JSON.stringify(cache));
console.log('Frame sets in the extractions: ' + sets.length);

// Step 2: PNGs for each set.
let converted = 0;
const frameNames = {};
for (const [file, names] of sets) {
  const folder = path.basename(path.dirname(file)) + '__' + path.basename(file, '.nsbtx');
  frameNames[folder] = names.map(n => n.replace(/\.(\d+)$/, '_$1'));
  const target = path.join(sources, folder);
  if (fs.existsSync(target)) continue;
  run(out.apicula, ['convert', file, '-o', target, '--more-textures']);
  converted++;
}
console.log('Converted ' + converted + ' new frame sets');

fs.writeFileSync(path.join(build, 'frame-names.json'), JSON.stringify(frameNames));

// Step 3: match and write.
require('./frames-match.js').run(out.data, sources, path.join(build, 'frame-names.json'), path.join(__dirname, '../../../hub/victory/data/layout.json'));
