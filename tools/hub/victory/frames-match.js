'use strict';
// Matches original animation frames and builds the NPC sheets used by the hub.
// Usage: node tools/hub/victory/frames-match.js <data dir> <sources dir> <frame-names.json> [layout.json]
const fs = require('fs'), path = require('path');
const { decode, encode } = require('./png.js');

function loadImage(file) {
  try { return decode(fs.readFileSync(file)); }
  catch (error) { console.error('Unable to load image ' + file + ': ' + error.message); return null; }
}

// Maps retain the insertion order of the original dictionaries, including numeric colour keys.
function shape(image) {
  const seen = new Map(), parts = [image.w, image.h];
  for (let p = 0; p < image.data.length; p += 4) {
    if (!image.data[p + 3]) { parts.push('-'); continue; }
    const colour = image.data.readUInt32BE(p);
    if (!seen.has(colour)) seen.set(colour, seen.size);
    parts.push(seen.get(colour));
  }
  return parts.join(',');
}

function colourCount(image) {
  const seen = new Set();
  for (let p = 0; p < image.data.length; p += 4)
    if (image.data[p + 3]) seen.add(image.data.readUInt32BE(p));
  return seen.size;
}

function colourMap(from, to) {
  const colours = new Map();
  for (let p = 0; p < from.data.length; p += 4)
    if (from.data[p + 3]) colours.set(from.data.readUInt32BE(p), Array.from(to.data.subarray(p, p + 4)));
  return colours;
}

// Color stores float32 channels. GDScript does the shift in double precision, then constructs
// a Color; Image.set_pixel multiplies its float32 channels by 255 and truncates to bytes.
const channel = Array.from({ length: 256 }, (_, n) => Math.fround(n / 255));
function recolour(image, colours) {
  const palette = Array.from(colours, ([key, to]) => ({
    from: [channel[key >>> 24], channel[key >>> 16 & 255], channel[key >>> 8 & 255]], to
  }));
  const shifted = new Map();
  for (let p = 0; p < image.data.length; p += 4) {
    if (!image.data[p + 3]) continue;
    const key = image.data.readUInt32BE(p);
    let colour = colours.get(key) || shifted.get(key);
    if (!colour) {
      const c = [channel[image.data[p]], channel[image.data[p + 1]], channel[image.data[p + 2]]];
      let best = null, gap = Infinity;
      for (const entry of palette) {
        const d = (entry.from[0] - c[0]) ** 2 + (entry.from[1] - c[1]) ** 2 + (entry.from[2] - c[2]) ** 2;
        if (d < gap) { gap = d; best = entry; }
      }
      if (!best) continue;
      colour = c.map((v, i) => {
        const value = Math.fround(Math.max(0, Math.min(1, v + channel[best.to[i]] - best.from[i])));
        return Math.trunc(Math.fround(value * 255));
      });
      colour.push(image.data[p + 3]);
      shifted.set(key, colour);
    }
    image.data.set(colour, p);
  }
}

// JSON.stringify in Godot sorts dictionary keys recursively and writes integer Variants without
// a decimal point. Build the object text directly so numeric-looking keys also stay sorted.
function json(value, level = 0) {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  const array = Array.isArray(value), keys = array ? value.map((_, i) => i) : Object.keys(value).sort();
  const open = array ? '[' : '{', close = array ? ']' : '}';
  if (!keys.length) return open + close;
  const indent = '  '.repeat(level + 1);
  return open + '\n' + keys.map(key => indent + (array ? '' : JSON.stringify(key) + ': ') + json(value[key], level + 1)).join(',\n') + '\n' + '  '.repeat(level) + close;
}

function filename(name) { return name.trim().replace(/[:/\\?*"|%<>]/g, '_'); }

function npcSprites(data, sources, layoutFile) {
  const layout = JSON.parse(fs.readFileSync(layoutFile, 'utf8')), index = Object.create(null);
  const npcs = (layout.npcs || []).slice();
  for (const interior of layout.interiors || []) npcs.push(...(interior.npcs || []));
  for (const npc of npcs) {
    const sprite = npc.sprite || '';
    if (!sprite || Object.prototype.hasOwnProperty.call(index, sprite)) continue;
    for (const game of ['hg-extract', 'pt-extract', 'b2-extract']) {
      const folder = path.join(sources, game + '__' + sprite);
      if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) continue;
      const stem = sprite.replace(/_1$/, ''), frames = [];
      for (let n = 1; ; n++) {
        const file = path.join(folder, stem + '_' + n + '.png');
        if (!fs.existsSync(file)) break;
        frames.push(loadImage(file));
      }
      if (frames.length < 16) continue;
      const { w, h } = frames[0], sheet = { w: w * frames.length, h, data: Buffer.alloc(w * frames.length * h * 4) };
      frames.forEach((frame, k) => {
        // blit_rect clips the source rectangle if a later frame has a different size.
        const width = Math.min(w, frame.w), height = Math.min(h, frame.h);
        for (let y = 0; y < height; y++)
          frame.data.copy(sheet.data, (y * sheet.w + k * w) * 4, y * frame.w * 4, (y * frame.w + width) * 4);
      });
      fs.mkdirSync(path.join(data, 'sprites'), { recursive: true });
      fs.writeFileSync(path.join(data, 'sprites', sprite + '.png'), encode(sheet));
      index[sprite] = { sheet: 'sprites/' + sprite + '.png', frames: frames.length, w, h };
      console.log('NPC sprite ' + sprite + ' <- ' + game + ' (' + frames.length + ' frames)');
      break;
    }
    if (!Object.prototype.hasOwnProperty.call(index, sprite)) console.log('NPC sprite ' + sprite + ' not found in the extractions');
  }
  fs.writeFileSync(path.join(data, 'npc-sprites.json'), json(index));
}

function run(dataDir, sourcesDir, frameNamesFile, layoutFile) {
  const frameNames = JSON.parse(fs.readFileSync(frameNamesFile, 'utf8')), byShape = new Map();
  let setCount = 0;
  for (const folder of fs.readdirSync(sourcesDir).sort()) {
    const dir = path.join(sourcesDir, folder);
    if (!fs.statSync(dir).isDirectory() || !Object.prototype.hasOwnProperty.call(frameNames, folder)) continue;
    const allowed = new Set(frameNames[folder]), groups = new Map();
    for (const file of fs.readdirSync(dir).sort()) {
      if (!allowed.has(path.basename(file, path.extname(file))) || !fs.statSync(path.join(dir, file)).isFile()) continue;
      const match = /^(.+)_(\d+)\.png$/.exec(file);
      if (!match) continue;
      if (!groups.has(match[1])) groups.set(match[1], new Map());
      groups.get(match[1]).set(Number(match[2]), path.join(dir, file));
    }
    for (const [base, group] of groups) {
      const numbers = Array.from(group.keys()).sort((a, b) => a - b);
      if (numbers.length < 2) continue;
      const paths = numbers.map(n => group.get(n)), images = paths.map(loadImage);
      if (images.some(image => image === null)) continue;
      const keys = images.map(shape);
      if (keys.every(key => key === keys[0]) && images.every(image => image.data.equals(images[0].data))) continue;
      setCount++;
      keys.forEach((key, k) => {
        // Equal-length sets keep the first match in sorted directory order.
        if (!byShape.has(key) || byShape.get(key).paths.length < paths.length)
          byShape.set(key, { paths, start: k, source: folder + ' ' + base });
      });
    }
  }
  console.log('Distinct animated frame sets: ' + setCount);
  const result = Object.create(null), materials = [];
  for (const group of ['terrain', 'buildings', 'decorations', 'deck', 'deck2']) {
    const mtl = path.join(dataDir, group, group + '.mtl');
    if (!fs.existsSync(mtl)) continue;
    let material = '';
    for (let line of fs.readFileSync(mtl, 'utf8').split('\n')) {
      line = line.trim();
      if (line.startsWith('newmtl ')) material = line.slice(7);
      else if (line.startsWith('map_Kd ') && !Object.prototype.hasOwnProperty.call(result, material)) {
        const image = loadImage(path.join(dataDir, group, line.slice(7)));
        if (!image) continue;
        const key = shape(image);
        if (colourCount(image) < 3 || !byShape.has(key)) continue;
        const entry = byShape.get(key), matchImage = loadImage(entry.paths[entry.start]);
        const colours = colourMap(matchImage, image), outDir = path.join(dataDir, 'frames', filename(material)), files = [];
        fs.mkdirSync(outDir, { recursive: true });
        entry.paths.forEach((file, n) => {
          const frame = loadImage(file);
          recolour(frame, colours);
          const name = n + '.png';
          fs.writeFileSync(path.join(outDir, name), encode(frame));
          files.push('frames/' + filename(material) + '/' + name);
        });
        result[material] = { frames: files, start: entry.start, source: entry.source };
        materials.push(material);
      }
    }
  }
  fs.writeFileSync(path.join(dataDir, 'frames.json'), json(result));
  console.log('Hub textures with original frames: ' + materials.length);
  for (const material of materials)
    console.log('  ' + material + ' <- ' + result[material].source + ' (' + result[material].frames.length + ' frames)');
  if (layoutFile !== undefined) npcSprites(dataDir, sourcesDir, layoutFile);
}

module.exports = { run };
if (require.main === module) {
  if (process.argv.length < 5) throw new Error('Usage: frames-match.js <data dir> <sources dir> <frame-names.json> [layout.json]');
  run(...process.argv.slice(2, 6));
}
