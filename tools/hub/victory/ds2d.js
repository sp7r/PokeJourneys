// Reads 2D graphics out of the player's own Nintendo DS ROM: the cartridge's file system, NARC
// archives, and the NCLR (palette), NCGR (tiles), NSCR (screen map) and NCER (cells) formats.
// Nothing is bundled: the hub's export step runs this against the player's ROM and writes PNGs into
// the hub data folder, which stays outside the repository (like the island's models).
//
//   node tools/hub/victory/ds2d.js list <rom.nds> [filter]       files in the ROM's file system
//   node tools/hub/victory/ds2d.js narc <rom.nds> <path>          the members of a NARC, with their kinds
//   node tools/hub/victory/ds2d.js namein <platinum.nds> <hub data dir>
//        the naming screen's pieces as PNGs into <dir>/ui/namein, for the hub's creator and name screen
//   node tools/hub/victory/ds2d.js render <rom.nds> <narc> <out> "screen|cell <member> <ncgr> <nclr>"...
//   node tools/hub/victory/ds2d.js render <rom.nds> <narc> <out> "tiles <ncgr> <nclr> [bank] [columns]"...
//        a tile sheet for graphics without a screen map (window frames, for example); bank defaults
//        to 0, columns to 16. Platinum pl_winframe: tiles 0 / palette 24, tiles 2 / palette 26.
//
// Formats as documented by the DS homebrew community (GBATEK; the Nitro file formats).
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// --- Cartridge file system --------------------------------------------------------------------

function readRom(file) {
  const rom = fs.readFileSync(file);
  const fntOffset = rom.readUInt32LE(0x40);
  const fatOffset = rom.readUInt32LE(0x48);
  const files = new Map(); // path -> Buffer slice
  const fat = (id) => {
    const start = rom.readUInt32LE(fatOffset + id * 8);
    const end = rom.readUInt32LE(fatOffset + id * 8 + 4);
    return rom.subarray(start, end);
  };
  const walk = (dirId, prefix) => {
    const entry = fntOffset + (dirId & 0xfff) * 8;
    let pos = fntOffset + rom.readUInt32LE(entry);
    let fileId = rom.readUInt16LE(entry + 4);
    for (;;) {
      const len = rom[pos++];
      if (len === 0) break;
      const isDir = len & 0x80;
      const name = rom.toString('latin1', pos, pos + (len & 0x7f));
      pos += len & 0x7f;
      if (isDir) {
        const sub = rom.readUInt16LE(pos);
        pos += 2;
        walk(sub, prefix + name + '/');
      } else {
        files.set(prefix + name, fat(fileId++));
      }
    }
  };
  walk(0xf000, '');
  return { rom, files, code: rom.toString('latin1', 0x0c, 0x10) };
}

// --- NARC -------------------------------------------------------------------------------------

function readNarc(buf) {
  if (buf.toString('latin1', 0, 4) !== 'NARC') throw new Error('not a NARC');
  let pos = buf.readUInt16LE(0x0c); // header size
  // BTAF: file allocation table
  if (buf.toString('latin1', pos, pos + 4) !== 'BTAF') throw new Error('no BTAF');
  const btafSize = buf.readUInt32LE(pos + 4);
  const count = buf.readUInt16LE(pos + 8);
  const ranges = [];
  for (let i = 0; i < count; i++) ranges.push([buf.readUInt32LE(pos + 12 + i * 8), buf.readUInt32LE(pos + 16 + i * 8)]);
  pos += btafSize;
  // BTNF: names (usually none)
  pos += buf.readUInt32LE(pos + 4);
  // GMIF: the data
  const data = pos + 8;
  return ranges.map(([s, e]) => buf.subarray(data + s, data + e));
}

// Many Gen 4 members are LZ77 compressed (type 0x10).
function decompress(buf) {
  if (buf.length < 4 || (buf[0] !== 0x10 && buf[0] !== 0x11)) return buf;
  const size = buf.readUInt32LE(0) >>> 8;
  if (size === 0 || size > 0x1000000) return buf;
  const out = Buffer.alloc(size);
  let src = 4, dst = 0;
  try {
    if (buf[0] === 0x10) {
      while (dst < size) {
        const flags = buf[src++];
        for (let bit = 7; bit >= 0 && dst < size; bit--) {
          if (flags & (1 << bit)) {
            const b1 = buf[src++], b2 = buf[src++];
            const len = (b1 >> 4) + 3, disp = ((b1 & 0xf) << 8 | b2) + 1;
            for (let i = 0; i < len; i++, dst++) out[dst] = out[dst - disp];
          } else out[dst++] = buf[src++];
        }
      }
    } else {
      while (dst < size) {
        const flags = buf[src++];
        for (let bit = 7; bit >= 0 && dst < size; bit--) {
          if (flags & (1 << bit)) {
            const b1 = buf[src++];
            let len, disp;
            const ind = b1 >> 4;
            if (ind === 0) { const b2 = buf[src++], b3 = buf[src++]; len = ((b1 & 0xf) << 4 | b2 >> 4) + 0x11; disp = ((b2 & 0xf) << 8 | b3) + 1; }
            else if (ind === 1) { const b2 = buf[src++], b3 = buf[src++], b4 = buf[src++]; len = ((b1 & 0xf) << 12 | b2 << 4 | b3 >> 4) + 0x111; disp = ((b3 & 0xf) << 8 | b4) + 1; }
            else { const b2 = buf[src++]; len = ind + 1; disp = ((b1 & 0xf) << 8 | b2) + 1; }
            for (let i = 0; i < len; i++, dst++) out[dst] = out[dst - disp];
          } else out[dst++] = buf[src++];
        }
      }
    }
  } catch (e) { return buf; }
  return out;
}

function kindOf(buf) {
  const magic = buf.toString('latin1', 0, 4);
  return { RLCN: 'NCLR', RGCN: 'NCGR', RCSN: 'NSCR', RECN: 'NCER', RNAN: 'NANR', NARC: 'NARC' }[magic] || magic.replace(/[^ -~]/g, '.');
}

// --- Nitro graphics ---------------------------------------------------------------------------

// The first section after the 16-byte Nitro header.
const section = (buf) => 0x10;

function bgr555(v) { return [(v & 31) * 255 / 31 | 0, (v >> 5 & 31) * 255 / 31 | 0, (v >> 10 & 31) * 255 / 31 | 0]; }

// NCLR: palettes of 16 colours (4bpp) or 256 (8bpp).
function readNclr(buf) {
  const s = section(buf);
  const depth = buf.readUInt32LE(s + 8);
  const size = buf.readUInt32LE(s + 0x10);
  const offset = s + 8 + buf.readUInt32LE(s + 0x14);
  const colors = [];
  for (let i = 0; i < size / 2; i++) colors.push(bgr555(buf.readUInt16LE(offset + i * 2)));
  const per = depth === 4 ? 256 : 16;
  const palettes = [];
  for (let i = 0; i < colors.length; i += per) palettes.push(colors.slice(i, i + per));
  return { depth, palettes };
}

// NCGR: 8x8 tiles, 4 or 8 bits a pixel; tiles[i] is 64 colour indices.
function readNcgr(buf) {
  const s = section(buf);
  const depth = buf.readUInt32LE(s + 0x0c);
  const mapping = buf.readUInt32LE(s + 0x10);
  const size = buf.readUInt32LE(s + 0x18);
  const offset = s + 8 + buf.readUInt32LE(s + 0x1c);
  const bpp = depth === 4 ? 8 : 4;
  const tileBytes = bpp * 8;
  const tiles = [];
  for (let t = 0; t * tileBytes < size; t++) {
    const px = new Uint8Array(64);
    for (let i = 0; i < 64; i++) {
      if (bpp === 8) px[i] = buf[offset + t * 64 + i];
      else { const b = buf[offset + t * 32 + (i >> 1)]; px[i] = i & 1 ? b >> 4 : b & 15; }
    }
    tiles.push(px);
  }
  return { bpp, mapping, tiles, bytes: buf.subarray(offset, offset + size) };
}

// NSCR: a background screen of tile entries (tile, flips, palette).
function readNscr(buf) {
  const s = section(buf);
  const width = buf.readUInt16LE(s + 8), height = buf.readUInt16LE(s + 0x0a);
  const size = buf.readUInt32LE(s + 0x10);
  const entries = [];
  for (let i = 0; i < size / 2; i++) entries.push(buf.readUInt16LE(s + 0x14 + i * 2));
  return { width, height, entries };
}

// NCER: cells, each a group of OAM sprites cut from the tiles.
function readNcer(buf) {
  const s = section(buf);
  const count = buf.readUInt16LE(s + 8);
  const attr = buf.readUInt16LE(s + 0x0a);
  const table = s + 8 + buf.readUInt32LE(s + 0x0c);
  const mapping = buf.readUInt32LE(s + 0x10);
  const stride = attr === 1 ? 16 : 8;
  const oamBase = table + count * stride;
  const SIZES = [[[8, 8], [16, 16], [32, 32], [64, 64]], [[16, 8], [32, 8], [32, 16], [64, 32]], [[8, 16], [8, 32], [16, 32], [32, 64]]];
  const cells = [];
  for (let c = 0; c < count; c++) {
    const n = buf.readUInt16LE(table + c * stride);
    const first = buf.readUInt32LE(table + c * stride + 4);
    const objs = [];
    for (let o = 0; o < n; o++) {
      const p = oamBase + first + o * 6;
      const a0 = buf.readUInt16LE(p), a1 = buf.readUInt16LE(p + 2), a2 = buf.readUInt16LE(p + 4);
      const shape = a0 >> 14, sz = a1 >> 14;
      let y = a0 & 0xff; if (y >= 128) y -= 256;
      let x = a1 & 0x1ff; if (x >= 256) x -= 512;
      const [w, h] = SIZES[shape][sz];
      objs.push({ x, y, w, h, hflip: !!(a1 & 0x1000), vflip: !!(a1 & 0x2000), tile: a2 & 0x3ff, pal: a2 >> 12, bpp8: !!(a0 & 0x2000) });
    }
    cells.push(objs);
  }
  return { mapping, cells };
}

// RGBA image helpers.
function image(w, h) { return { w, h, data: Buffer.alloc(w * h * 4) }; }
function put(img, x, y, rgb, alpha = 255) {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
  const i = (y * img.w + x) * 4;
  img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]; img.data[i + 3] = alpha;
}

// A screen drawn with its tiles and palettes; colour 0 of each palette is transparent.
function renderScreen(scr, chr, pal) {
  const img = image(scr.width, scr.height);
  const cols = scr.width / 8;
  scr.entries.forEach((e, i) => {
    const tile = chr.tiles[e & 0x3ff];
    if (!tile) return;
    const palette = pal.palettes[chr.bpp === 8 ? 0 : (e >> 12)] || pal.palettes[0];
    const tx = (i % cols) * 8, ty = Math.floor(i / cols) * 8;
    for (let p = 0; p < 64; p++) {
      const v = tile[p];
      if (v === 0) continue;
      let px = p & 7, py = p >> 3;
      if (e & 0x400) px = 7 - px;
      if (e & 0x800) py = 7 - py;
      put(img, tx + px, ty + py, palette[v] || [255, 0, 255]);
    }
  });
  return img;
}

// Loose tiles in cartridge order, using one palette bank. Useful for finding the nine frame
// tiles and the separate cursor tiles in archives whose screen maps are built by the game.
function renderTiles(chr, pal, bank = 0, columns = 16) {
  if (!Number.isInteger(columns) || columns < 1 || columns > 128) throw new Error('columns must be 1..128');
  if (!pal.palettes[bank]) throw new Error(`missing palette bank ${bank}`);
  const img = image(columns * 8, Math.ceil(chr.tiles.length / columns) * 8);
  chr.tiles.forEach((tile, i) => {
    for (let p = 0; p < 64; p++) if (tile[p]) {
      put(img, (i % columns) * 8 + (p & 7), Math.floor(i / columns) * 8 + (p >> 3),
        pal.palettes[bank][tile[p]] || [255, 0, 255]);
    }
  });
  return img;
}

// One cell drawn into its own bounding box. Tiles are 1D-mapped: a sprite's tiles follow on.
function renderCell(objs, chr, pal, mapping) {
  if (!objs.length) return null;
  const minX = Math.min(...objs.map((o) => o.x)), minY = Math.min(...objs.map((o) => o.y));
  const maxX = Math.max(...objs.map((o) => o.x + o.w)), maxY = Math.max(...objs.map((o) => o.y + o.h));
  const img = image(maxX - minX, maxY - minY);
  // NCER mapping: 1D with a 32 << n byte boundary (n = mapping & 7 for the common 1D modes).
  const boundary = 32 << (mapping & 0x7);
  const tileBytes = chr.bpp * 8;
  for (const o of objs) {
    const start = o.tile * boundary / tileBytes;
    const tw = o.w / 8, th = o.h / 8;
    const palette = pal.palettes[chr.bpp === 8 ? 0 : o.pal] || pal.palettes[0];
    for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
      const tile = chr.tiles[start + ty * tw + tx];
      if (!tile) continue;
      for (let p = 0; p < 64; p++) {
        const v = tile[p];
        if (v === 0) continue;
        let px = tx * 8 + (p & 7), py = ty * 8 + (p >> 3);
        if (o.hflip) px = o.w - 1 - px;
        if (o.vflip) py = o.h - 1 - py;
        put(img, o.x - minX + px, o.y - minY + py, palette[v] || [255, 0, 255]);
      }
    }
  }
  return img;
}

// PNG writer (RGBA, no filtering).
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(img) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0); ihdr.writeUInt32BE(img.h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((img.w * 4 + 1) * img.h);
  for (let y = 0; y < img.h; y++) img.data.copy(raw, y * (img.w * 4 + 1) + 1, y * img.w * 4, (y + 1) * img.w * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// --- The naming screen ------------------------------------------------------------------------

// Platinum's naming screen, data/namein.narc: 0-1 palettes (0 the green set, 1 the trainer's
// purple set for the frames), 2 the background tiles, 3 the bottom screen's tiles, 4 the top
// screen (the name box), 5 the bottom screen, 6-9 the keyboard pages, 10 + 12 the sprite tiles and
// cells (tabs, BACK / OK, cursor corners, the keyboard frame).
function exportCaptain(files, code, out) {
  if (!/^IRE[A-Z]$/.test(code)) throw new Error('expected Black 2 (IRE*), got ' + code);
  const m = readNarc(files.get('a/0/2/7')).map(decompress);
  const bars = renderScreen(readNscr(m[2]), readNcgr(m[0]), readNclr(m[1]));
  const crop = (src, x, y, w, h) => {
    const dst = image(w, h);
    for (let row = 0; row < h; row++) src.data.copy(dst.data, row*w*4, ((y+row)*src.w+x)*4, ((y+row)*src.w+x+w)*4);
    return dst;
  };
  const cells = readNcer(m[4]);
  fs.mkdirSync(out, {recursive:true});
  for (const [name, img] of Object.entries({
    active: crop(bars,2,18,252,22), dim: crop(bars,2,138,252,22),
    background: crop(renderScreen(readNscr(m[9]),readNcgr(m[7]),readNclr(m[8])),0,0,256,192),
    cursor: renderCell(cells.cells[0],readNcgr(m[5]),readNclr(m[6]),cells.mapping)
  })) fs.writeFileSync(path.join(out,name+'.png'),png(img));
  fs.writeFileSync(path.join(out,'slices.json'),JSON.stringify({left:6,right:6,top:5,bottom:5},null,2));
  console.log('captain menu: '+out);
}

function exportNamein(files, code, out) {
  if (!['CPUE', 'CPUP', 'CPUJ', 'CPUD', 'CPUF', 'CPUI', 'CPUS', 'CPUK'].includes(code)) {
    throw new Error(`expected a Pokémon Platinum ROM (CPU*), got ${code}`);
  }
  const m = readNarc(files.get('data/namein.narc')).map(decompress);
  const green = readNclr(m[0]), purple = readNclr(m[1]);
  const bg = readNcgr(m[2]), bottomTiles = readNcgr(m[3]), spriteTiles = readNcgr(m[10]);
  const ncer = readNcer(m[12]);
  fs.mkdirSync(out, { recursive: true });
  const write = (name, img) => fs.writeFileSync(path.join(out, name), png(img));
  write('top.png', renderScreen(readNscr(m[4]), bg, green));
  write('bottom.png', renderScreen(readNscr(m[5]), bottomTiles, purple));
  ['pink', 'orange', 'blue', 'green'].forEach((name, i) => write(`page-${name}.png`, renderScreen(readNscr(m[6 + i]), bg, green)));
  // Every cell, with where its top-left sits from the sprite's position (cells.json).
  const cells = {};
  ncer.cells.forEach((objs, i) => {
    if (!objs.length) return;
    // The keyboard frame (cell 31) takes the purple frames palette; the rest their own.
    const img = renderCell(objs, spriteTiles, i === 31 ? purple : green, ncer.mapping);
    const name = `cell-${String(i).padStart(2, '0')}.png`;
    write(name, img);
    cells[i] = { file: name, x: Math.min(...objs.map((o) => o.x)), y: Math.min(...objs.map((o) => o.y)), w: img.w, h: img.h };
  });
  fs.writeFileSync(path.join(out, 'cells.json'), JSON.stringify(cells, null, 1));
  console.log(`naming screen: ${Object.keys(cells).length} cells, screens and pages in ${out}`);
  exportFont(files, path.join(out, '..', 'font'));
  exportButtons(files, path.join(out, '..', 'buttons'));
}

// Platinum's text font (graphic/pl_font.narc member 0): a 16-byte header (glyph data at 0x10, the
// width table's offset, the glyph count), then 16 x 16 glyphs of 2 bits a pixel in four 8 x 8 tiles
// (1 the text, 2 its shadow, 3 the box behind, 0 nothing), then a width a glyph. Glyph n is the
// game's character code n + 1. Written as an AngelCode bitmap font (font.fnt + font.png), which
// Godot loads as it is: the text dark, its shadow light, the rest clear.
const FONT_CODES = (() => {
  const map = { ' ': 0x1de, '!': 0x1ab, '?': 0x1ac, ',': 0x1ad, '.': 0x1ae, '/': 0x1b1, '’': 0x1b3,
    "'": 0x1b3, '(': 0x1b9, ')': 0x1ba, '+': 0x1bd, '-': 0x1be, '*': 0x1bf, '#': 0x1c0, '=': 0x1c1, '&': 0x1c2,
    '~': 0x1c3, ':': 0x1c4, ';': 0x1c5, '%': 0x1d2, '…': 0x1af, 'é': 0x188, 'É': 0x168 };
  for (let i = 0; i < 10; i++) map[String(i)] = 0x121 + i;
  for (let i = 0; i < 26; i++) { map[String.fromCharCode(65 + i)] = 0x12b + i; map[String.fromCharCode(97 + i)] = 0x145 + i; }
  return map;
})();

function exportFont(files, out) {
  const f = decompress(readNarc(files.get('graphic/pl_font.narc'))[0]);
  const widths = f.readUInt32LE(4), count = f.readUInt32LE(8);
  const glyphPx = (g, x, y) => {
    // Tiles left to right, top to bottom; within a row the leftmost pixel is the top two bits.
    const tile = (y >> 3) * 2 + (x >> 3), xx = 7 - (x & 7);
    return (f.readUInt16LE(16 + g * 64 + tile * 16 + (y & 7) * 2) >> (2 * xx)) & 3;
  };
  const chars = Object.entries(FONT_CODES).filter(([, code]) => code - 1 < count);
  const cols = 16, atlas = image(cols * 16, Math.ceil(chars.length / cols) * 16);
  const lines = [];
  chars.forEach(([ch, code], i) => {
    const g = code - 1, ox = (i % cols) * 16, oy = Math.floor(i / cols) * 16;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const v = glyphPx(g, x, y);
      if (v === 1) put(atlas, ox + x, oy + y, [40, 40, 48]);
      else if (v === 2) put(atlas, ox + x, oy + y, [176, 176, 184]);
    }
    // The width counts the shadow's column; one more keeps letters from touching, as the game spaces them.
    lines.push(`char id=${ch.codePointAt(0)} x=${ox} y=${oy} width=16 height=16 xoffset=0 yoffset=0 xadvance=${(f[widths + g] || 7) + 1} page=0 chnl=15`);
  });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'font.png'), png(atlas));
  fs.writeFileSync(path.join(out, 'font.fnt'), [
    'info face="Platinum" size=16 bold=0 italic=0 unicode=1 stretchH=100 smooth=0 aa=1 padding=0,0,0,0 spacing=0,0',
    `common lineHeight=16 base=13 scaleW=${atlas.w} scaleH=${atlas.h} pages=1 packed=0`,
    'page id=0 file="font.png"', `chars count=${lines.length}`, ...lines, ''].join('\n'));
  console.log(`font: ${lines.length} characters in ${out}`);
}

// Platinum's touch-screen YES / NO buttons (graphic/touch_subwindow.narc: palette 0, tiles 1,
// screens 2-9: red and blue, normal and lit, then the faded pair), each 48 x 32. The word is
// cleared by stretching the column just inside the left rim across the middle, so a button can
// carry any label.
function exportButtons(files, out) {
  const m = readNarc(files.get('graphic/touch_subwindow.narc')).map(decompress);
  const chr = readNcgr(m[1]), pal = readNclr(m[0]);
  fs.mkdirSync(out, { recursive: true });
  [['red', 2], ['blue', 3], ['red-lit', 4], ['blue-lit', 5]].forEach(([name, s]) => {
    const src = renderScreen(readNscr(m[s]), chr, pal);
    const blank = image(src.w, src.h);
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      const sx = x < 7 || x >= src.w - 7 ? x : 6;
      src.data.copy(blank.data, (y * src.w + x) * 4, (y * src.w + sx) * 4, (y * src.w + sx) * 4 + 4);
    }
    fs.writeFileSync(path.join(out, `${name}.png`), png(blank));
  });
  console.log(`buttons in ${out}`);
}

// --- Command line -----------------------------------------------------------------------------

function main() {
  const [cmd, romFile, arg] = process.argv.slice(2);
  if (!cmd || !romFile) { console.log('usage: ds2d.js list|narc <rom.nds> [filter|path]'); process.exit(1); }
  const { files, code } = readRom(romFile);
  if (cmd === 'list') {
    console.log('game code', code, files.size, 'files');
    for (const [name, buf] of files) if (!arg || name.toLowerCase().includes(arg.toLowerCase())) console.log(name, buf.length);
  } else if (cmd === 'narc') {
    const members = readNarc(files.get(arg));
    members.forEach((m, i) => { const d = decompress(m); console.log(i, kindOf(d), d.length, d === m ? '' : '(lz)'); });
  } else if (cmd === 'captain') {
    exportCaptain(files, code, path.join(arg, 'ui', 'captain'));
  } else if (cmd === 'namein') {
    // namein <rom> <hub data dir>: the naming screen's pieces from Platinum's data/namein.narc, for
    // the hub's character creator and name screen, into <dir>/ui/namein (see exportNamein).
    exportNamein(files, code, path.join(arg, 'ui', 'namein'));
  } else if (cmd === 'render') {
    // render <rom> <narc> <out dir> "<screen|cell> <member> <ncgr> <nclr>" ...: a PNG per job.
    const [out, ...jobs] = process.argv.slice(5);
    const members = readNarc(files.get(arg)).map(decompress);
    fs.mkdirSync(out, { recursive: true });
    for (const job of jobs) {
      if (job.startsWith('tiles ')) {
        const [, g, p, bank = '0', columns = '16'] = job.split(/\s+/);
        fs.writeFileSync(path.join(out, `tiles${g}-p${p}-bank${bank}.png`),
          png(renderTiles(readNcgr(members[+g]), readNclr(members[+p]), +bank, +columns)));
        continue;
      }
      const [kind, m, g, p] = job.split(' ');
      const chr = readNcgr(members[+g]), pal = readNclr(members[+p]);
      if (kind === 'screen') {
        fs.writeFileSync(path.join(out, `screen${m}-g${g}-p${p}.png`), png(renderScreen(readNscr(members[+m]), chr, pal)));
      } else {
        const ncer = readNcer(members[+m]);
        ncer.cells.forEach((objs, i) => {
          const img = renderCell(objs, chr, pal, ncer.mapping);
          if (img) fs.writeFileSync(path.join(out, `cell${m}-${String(i).padStart(3, '0')}.png`), png(img));
        });
        console.log('cells', ncer.cells.length, 'mapping', ncer.mapping);
      }
    }
  }
}

module.exports = { readRom, readNarc, decompress, kindOf, readNclr, readNcgr, readNscr, readNcer, renderScreen, renderTiles, renderCell, png, image, put };
if (require.main === module) main();
