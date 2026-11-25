'use strict';
const { inflateSync } = require('zlib');

// Non-interlaced PNGs, expanded to the RGBA image format used by ds2d.js.
function decode(buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    throw new Error('Invalid PNG signature');
  let w, h, depth, type, palette, transparency, ended = false;
  const idat = [];
  for (let p = 8; p < buffer.length;) {
    if (p + 12 > buffer.length) throw new Error('Truncated PNG chunk');
    const length = buffer.readUInt32BE(p), name = buffer.toString('ascii', p + 4, p + 8);
    const end = p + 8 + length;
    if (end + 4 > buffer.length) throw new Error('Truncated PNG chunk');
    const chunk = buffer.subarray(p + 8, end);
    if (p === 8 && name !== 'IHDR') throw new Error('Missing PNG header');
    if (name === 'IHDR') {
      if (w !== undefined || length !== 13) throw new Error('Invalid PNG header');
      w = chunk.readUInt32BE(0); h = chunk.readUInt32BE(4); depth = chunk[8]; type = chunk[9];
      if (!w || !h) throw new Error('Invalid PNG dimensions');
      if (chunk[12] !== 0) throw new Error('Interlaced PNGs are not supported');
      if (chunk[10] !== 0 || chunk[11] !== 0) throw new Error('Unsupported PNG compression or filter method');
      if (![0, 2, 3, 4, 6].includes(type) || (depth !== 8 && !([0, 3].includes(type) && [1, 2, 4].includes(depth))))
        throw new Error('Unsupported PNG colour type or bit depth');
    } else if (name === 'PLTE') palette = chunk;
    else if (name === 'tRNS') transparency = chunk;
    else if (name === 'IDAT') idat.push(chunk);
    else if (name === 'IEND') { ended = true; break; }
    p = end + 4;
  }
  if (w === undefined || !ended || !idat.length) throw new Error('Incomplete PNG');
  if (type === 3 && (!palette || !palette.length || palette.length % 3 || palette.length > 3 * (1 << depth)))
    throw new Error('Invalid PNG palette');
  if (transparency && ((type === 0 && transparency.length !== 2) || (type === 2 && transparency.length !== 6) ||
      (type === 3 && transparency.length > palette.length / 3) || type === 4 || type === 6))
    throw new Error('Invalid PNG transparency');

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  const stride = Math.ceil(w * channels * depth / 8), bpp = Math.max(1, Math.ceil(channels * depth / 8));
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length !== (stride + 1) * h) throw new Error('Invalid PNG pixel data length');
  const rows = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const start = y * stride, source = y * (stride + 1), filter = raw[source];
    if (filter > 4) throw new Error('Invalid PNG filter');
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? rows[start + x - bpp] : 0;
      const b = y ? rows[start + x - stride] : 0;
      const c = y && x >= bpp ? rows[start + x - stride - bpp] : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = Math.floor((a + b) / 2);
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      rows[start + x] = (raw[source + x + 1] + predictor) & 255;
    }
  }

  const data = Buffer.alloc(w * h * 4), mask = (1 << depth) - 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * stride + x * channels, out = (y * w + x) * 4;
    const sample = depth === 8 ? rows[p] : (rows[y * stride + (x * depth >> 3)] >> (8 - depth - x * depth % 8)) & mask;
    let r, g, b, a = 255;
    if (type === 0 || type === 4) {
      r = g = b = sample * 255 / mask;
      if (type === 4) a = rows[p + 1];
      else if (transparency && sample === transparency.readUInt16BE(0)) a = 0;
    } else if (type === 3) {
      if (sample * 3 >= palette.length) throw new Error('PNG palette index out of range');
      r = palette[sample * 3]; g = palette[sample * 3 + 1]; b = palette[sample * 3 + 2];
      if (transparency && sample < transparency.length) a = transparency[sample];
    } else {
      r = sample; g = rows[p + 1]; b = rows[p + 2];
      if (type === 6) a = rows[p + 3];
      else if (transparency && r === transparency.readUInt16BE(0) && g === transparency.readUInt16BE(2) && b === transparency.readUInt16BE(4)) a = 0;
    }
    data[out] = r; data[out + 1] = g; data[out + 2] = b; data[out + 3] = a;
  }
  return { w, h, data };
}

function encode(img) { return require('./ds2d.js').png(img); }

module.exports = { decode, encode };
