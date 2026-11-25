// Runs the hub's Node tools under QuickJS (quickjs-ng's qjs), as the app does on the phone to build the hub data
// from the player's own cartridges: qjs node.mjs <script.js> [args...]. Gives the scripts the small part of Node they
// use: require (CommonJS), Buffer, process, console, and the fs, path, zlib, crypto and child_process modules.
import * as std from 'qjs:std';
import * as os from 'qjs:os';

// ---- text ----
// Written for an interpreter: typed arrays and whole chunks, never one string or array element at a time.
function utf8Encode(s) {
  const out = new Uint8Array(s.length * 3); let n = 0;
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) { out[n++] = c; continue; }
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) { const d = s.charCodeAt(i + 1); if (d >= 0xdc00 && d < 0xe000) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; } }
    if (c < 0x800) { out[n++] = 0xc0 | c >> 6; out[n++] = 0x80 | c & 63; }
    else if (c < 0x10000) { out[n++] = 0xe0 | c >> 12; out[n++] = 0x80 | c >> 6 & 63; out[n++] = 0x80 | c & 63; }
    else { out[n++] = 0xf0 | c >> 18; out[n++] = 0x80 | c >> 12 & 63; out[n++] = 0x80 | c >> 6 & 63; out[n++] = 0x80 | c & 63; }
  }
  return out.subarray(0, n);
}
function codes(b, start, end) { // char codes to a string, 8 KB at a time
  const parts = [];
  for (let i = start; i < end; i += 8192) parts.push(String.fromCharCode.apply(null, b.subarray(i, Math.min(end, i + 8192))));
  return parts.join('');
}
function utf8Decode(b, start, end) {
  let ascii = true; for (let i = start; i < end; i++) if (b[i] > 127) { ascii = false; break; }
  if (ascii) return codes(b, start, end);
  const u = new Uint16Array(end - start); let n = 0;
  for (let i = start; i < end;) {
    let c = b[i++];
    if (c >= 0xf0) c = (c & 7) << 18 | (b[i++] & 63) << 12 | (b[i++] & 63) << 6 | b[i++] & 63;
    else if (c >= 0xe0) c = (c & 15) << 12 | (b[i++] & 63) << 6 | b[i++] & 63;
    else if (c >= 0xc0) c = (c & 31) << 6 | b[i++] & 63;
    if (c >= 0x10000) { c -= 0x10000; u[n++] = 0xd800 + (c >> 10); u[n++] = 0xdc00 + (c & 1023); } else u[n++] = c;
  }
  return codes(u, 0, n);
}
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// QuickJS splits on a regular expression slowly (seconds for a big OBJ). The two the exporters split with all the time,
// /\r?\n/ and /\s+/, take a plain-string split when it gives exactly the same result.
const nativeSplit = String.prototype.split;
const OTHER_SPACE = [9, 10, 11, 12, 13, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff].map(c => String.fromCharCode(c));
Object.defineProperty(String.prototype, 'split', { configurable: true, writable: true, value: function split(sep, limit) {
  if (sep instanceof RegExp && limit === undefined && sep.flags === '') {
    const s = String(this);
    if (sep.source === '\\r?\\n') {
      const parts = nativeSplit.call(s, '\n');
      if (s.indexOf('\r') >= 0) for (let i = 0; i < parts.length - 1; i++) { const p = parts[i]; if (p.charCodeAt(p.length - 1) === 13) parts[i] = p.slice(0, -1); }
      return parts;
    }
    if (sep.source === '\\s+' && s.indexOf('  ') < 0 && !OTHER_SPACE.some(c => s.indexOf(c) >= 0)) return nativeSplit.call(s, ' ');
  }
  return nativeSplit.call(this, sep, limit);
} });

// ---- Buffer ----
class Buffer extends Uint8Array {
  static alloc(n, fill = 0) { const b = new Buffer(n); if (fill) b.fill(fill); return b; }
  static allocUnsafe(n) { return new Buffer(n); }
  static isBuffer(x) { return x instanceof Buffer; }
  static byteLength(s) { return typeof s === 'string' ? utf8Encode(s).length : s.length; }
  static from(x, enc, len) {
    if (typeof x === 'string') {
      if (enc === 'hex') { const b = new Buffer(x.length >> 1); for (let i = 0; i < b.length; i++) b[i] = parseInt(x.substr(i * 2, 2), 16); return b; }
      if (enc === 'base64') { const s = x.replace(/[^A-Za-z0-9+/]/g, ''), out = []; for (let i = 0; i < s.length; i += 4) { const n = [0, 1, 2, 3].map(k => B64.indexOf(s[i + k] || 'A')); const v = n[0] << 18 | n[1] << 12 | n[2] << 6 | n[3]; out.push(v >> 16 & 255); if (s[i + 2]) out.push(v >> 8 & 255); if (s[i + 3]) out.push(v & 255); } return Buffer.from(out); }
      if (enc === 'ascii' || enc === 'latin1' || enc === 'binary') { const b = new Buffer(x.length); for (let i = 0; i < x.length; i++) b[i] = x.charCodeAt(i) & 255; return b; }
      const u = utf8Encode(x), b = new Buffer(u.length); b.set(u); return b;
    }
    if (x instanceof ArrayBuffer) return new Buffer(x, enc || 0, len ?? x.byteLength - (enc || 0));
    if (ArrayBuffer.isView(x)) { const b = new Buffer(x.length); b.set(x); return b; }
    const b = new Buffer(x.length); for (let i = 0; i < x.length; i++) b[i] = x[i]; return b;
  }
  static concat(list, total) {
    total ??= list.reduce((n, b) => n + b.length, 0); const out = new Buffer(total); let p = 0;
    for (const b of list) { out.set(b.subarray(0, Math.min(b.length, total - p)), p); p += b.length; if (p >= total) break; } return out;
  }
  get view() { return this._v || (this._v = new DataView(this.buffer, this.byteOffset, this.byteLength)); }
  slice(a, b) { return this.subarray(a, b); }
  toString(enc = 'utf8', start = 0, end = this.length) {
    start = Math.max(0, start); end = Math.min(this.length, end);
    if (enc === 'latin1' || enc === 'binary') return codes(this, start, end);
    if (enc === 'ascii') { const a = this.slice(start, end).map(x => x & 127); return codes(a, 0, a.length); }
    if (enc === 'hex') { let s = ''; for (let i = start; i < end; i++) s += (this[i] < 16 ? '0' : '') + this[i].toString(16); return s; }
    if (enc === 'base64') { let s = ''; for (let i = start; i < end; i += 3) { const n = this[i] << 16 | (i + 1 < end ? this[i + 1] << 8 : 0) | (i + 2 < end ? this[i + 2] : 0); s += B64[n >> 18 & 63] + B64[n >> 12 & 63] + (i + 1 < end ? B64[n >> 6 & 63] : '=') + (i + 2 < end ? B64[n & 63] : '='); } return s; }
    return utf8Decode(this, start, end);
  }
  toJSON() { return { type: 'Buffer', data: Array.from(this) }; }
  equals(o) { if (o.length !== this.length) return false; for (let i = 0; i < this.length; i++) if (this[i] !== o[i]) return false; return true; }
  compare(o) { const n = Math.min(this.length, o.length); for (let i = 0; i < n; i++) if (this[i] !== o[i]) return this[i] < o[i] ? -1 : 1; return this.length === o.length ? 0 : this.length < o.length ? -1 : 1; }
  copy(target, tStart = 0, sStart = 0, sEnd = this.length) { const part = this.subarray(sStart, Math.min(sEnd, sStart + target.length - tStart)); target.set(part, tStart); return part.length; }
  indexOf(v, from = 0, enc) {
    if (typeof v === 'number') return super.indexOf(v, from);
    const n = typeof v === 'string' ? Buffer.from(v, enc) : v; if (!n.length) return from;
    outer: for (let i = super.indexOf(n[0], from); i >= 0 && i <= this.length - n.length; i = super.indexOf(n[0], i + 1)) { for (let k = 1; k < n.length; k++) if (this[i + k] !== n[k]) continue outer; return i; }
    return -1;
  }
  includes(v, from, enc) { return this.indexOf(v, from, enc) >= 0; }
  write(s, offset = 0, enc) { const b = Buffer.from(s, enc); this.set(b.subarray(0, this.length - offset), offset); return Math.min(b.length, this.length - offset); }
  readUIntLE(o, n) { let v = 0; for (let i = n - 1; i >= 0; i--) v = v * 256 + this[o + i]; return v; }
  readUIntBE(o, n) { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + this[o + i]; return v; }
  readIntLE(o, n) { const v = this.readUIntLE(o, n), m = 2 ** (8 * n - 1); return v >= m ? v - 2 * m : v; }
  writeUIntLE(v, o, n) { for (let i = 0; i < n; i++) { this[o + i] = v & 255; v = Math.floor(v / 256); } return o + n; }
}
const methods = { UInt8: ['Uint8', 1], Int8: ['Int8', 1], UInt16: ['Uint16', 2], Int16: ['Int16', 2], UInt32: ['Uint32', 4], Int32: ['Int32', 4], Float: ['Float32', 4], Double: ['Float64', 8], BigUInt64: ['BigUint64', 8], BigInt64: ['BigInt64', 8] };
for (const [name, [dv, size]] of Object.entries(methods)) for (const end of size === 1 ? [''] : ['LE', 'BE']) {
  const le = end === 'LE', bounds = (b, o) => { if (o < 0 || o + size > b.length) throw new RangeError(`offset ${o} is out of range`); };
  Buffer.prototype['read' + name + end] = function (o = 0) { bounds(this, o); return this.view['get' + dv](o, le); };
  Buffer.prototype['write' + name + end] = function (v, o = 0) { bounds(this, o); this.view['set' + dv](o, v, le); return o + size; };
}
for (const n of ['UInt8', 'UInt16LE', 'UInt16BE', 'UInt32LE', 'UInt32BE']) Buffer.prototype['read' + n.replace('UInt', 'Uint')] = Buffer.prototype['read' + n];

// ---- path (POSIX) ----
const path = {
  sep: '/', delimiter: ':',
  normalize(p) {
    const abs = p.startsWith('/'), out = [];
    for (const s of p.split('/')) { if (!s || s === '.') continue; if (s === '..' && out.length && out[out.length - 1] !== '..') out.pop(); else if (s !== '..' || !abs) out.push(s); }
    const r = (abs ? '/' : '') + out.join('/'); return r || (abs ? '/' : '.');
  },
  join(...p) { return path.normalize(p.filter(s => s !== '').join('/') || '.'); },
  resolve(...p) { let r = ''; for (let i = p.length - 1; i >= 0 && !r.startsWith('/'); i--) r = p[i] + (r ? '/' + r : ''); if (!r.startsWith('/')) r = process.cwd() + '/' + r; return path.normalize(r); },
  isAbsolute(p) { return p.startsWith('/'); },
  dirname(p) { const n = p.replace(/\/+$/, ''), i = n.lastIndexOf('/'); return i < 0 ? '.' : i === 0 ? '/' : n.slice(0, i); },
  basename(p, ext) { const b = p.replace(/\/+$/, '').split('/').pop(); return ext && b.endsWith(ext) && b !== ext ? b.slice(0, -ext.length) : b; },
  extname(p) { const b = path.basename(p), i = b.lastIndexOf('.'); return i <= 0 ? '' : b.slice(i); },
  relative(from, to) {
    const a = path.resolve(from).split('/').filter(Boolean), b = path.resolve(to).split('/').filter(Boolean); let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
  },
  parse(p) { const base = path.basename(p), ext = path.extname(p); return { root: p.startsWith('/') ? '/' : '', dir: path.dirname(p), base, ext, name: ext ? base.slice(0, -ext.length) : base }; }
};
path.posix = path;

// ---- fs ----
const S_IFMT = 0o170000, S_IFDIR = 0o040000, S_IFREG = 0o100000, S_IFLNK = 0o120000;
function fail(code, what, p) { const e = new Error(`${code}: ${what}, '${p}'`); e.code = code; throw e; }
function stats(st) {
  return { size: st.size, mode: st.mode, mtimeMs: st.mtime, isDirectory: () => (st.mode & S_IFMT) === S_IFDIR, isFile: () => (st.mode & S_IFMT) === S_IFREG, isSymbolicLink: () => (st.mode & S_IFMT) === S_IFLNK };
}
const fs = {
  existsSync(p) { return os.stat(String(p))[1] === 0; },
  statSync(p) { const [st, err] = os.stat(String(p)); if (err) fail('ENOENT', 'no such file or directory, stat', p); return stats(st); },
  lstatSync(p) { const [st, err] = os.lstat(String(p)); if (err) fail('ENOENT', 'no such file or directory, lstat', p); return stats(st); },
  realpathSync(p) { const [r, err] = os.realpath(String(p)); if (err) fail('ENOENT', 'no such file or directory, realpath', p); return r; },
  readFileSync(p, opt) {
    const enc = typeof opt === 'string' ? opt : opt?.encoding;
    if (enc === 'utf8' || enc === 'utf-8') { const s = std.loadFile(String(p)); if (s === null) fail('ENOENT', 'no such file or directory, open', p); return s; } // decoded natively
    const f = std.open(String(p), 'rb');
    if (!f) fail('ENOENT', 'no such file or directory, open', p);
    f.seek(0, std.SEEK_END); const n = f.tell(); f.seek(0, std.SEEK_SET);
    const b = new Buffer(n); let got = 0; while (got < n) { const k = f.read(b.buffer, got, n - got); if (k <= 0) break; got += k; }
    f.close(); if (got !== n) fail('EIO', 'short read', p); return enc ? b.toString(enc) : b;
  },
  // file handles for reading parts of big files (a cartridge); only 'r'
  openSync(p, flags = 'r') { if (flags !== 'r') fail('EINVAL', 'only r is supported, open', p); const f = std.open(String(p), 'rb'); if (!f) fail('ENOENT', 'no such file or directory, open', p); return f; },
  readSync(f, b, offset = 0, length = b.length - offset, position = null) {
    if (position !== null && position !== undefined) f.seek(position, std.SEEK_SET);
    let got = 0; while (got < length) { const k = f.read(b.buffer, b.byteOffset + offset + got, length - got); if (k <= 0) break; got += k; }
    return got;
  },
  closeSync(f) { f.close(); },
  writeFileSync(p, data, opt) {
    const enc = typeof opt === 'string' ? opt : opt?.encoding;
    if (typeof data === 'string' && (!enc || enc === 'utf8' || enc === 'utf-8')) { // encoded natively
      const f = std.open(String(p), 'wb'); if (!f) fail('ENOENT', 'cannot write', p); f.puts(data); if (f.close() !== 0) fail('EIO', 'write failed', p); return;
    }
    const b = typeof data === 'string' ? Buffer.from(data, typeof opt === 'string' ? opt : opt?.encoding) : data;
    const f = std.open(String(p), 'wb'); if (!f) fail('ENOENT', 'cannot write', p);
    if (b.length) f.write(b.buffer, b.byteOffset, b.length); if (f.close() !== 0) fail('EIO', 'write failed', p);
  },
  appendFileSync(p, data) { const f = std.open(String(p), 'ab'); const b = typeof data === 'string' ? Buffer.from(data) : data; f.write(b.buffer, b.byteOffset, b.length); f.close(); },
  copyFileSync(a, b) { fs.writeFileSync(b, fs.readFileSync(a)); },
  mkdirSync(p, opt) {
    p = path.resolve(String(p));
    if (opt?.recursive) { if (fs.existsSync(p)) return; fs.mkdirSync(path.dirname(p), opt); }
    const err = os.mkdir(p, 0o777); if (err && !(opt?.recursive && fs.existsSync(p))) fail(-err === 17 ? 'EEXIST' : 'ENOENT', 'mkdir failed', p);
  },
  readdirSync(p, opt) {
    const [list, err] = os.readdir(String(p)); if (err) fail('ENOENT', 'no such file or directory, scandir', p);
    const names = list.filter(n => n !== '.' && n !== '..').sort();
    return opt?.withFileTypes ? names.map(name => { const st = fs.lstatSync(path.join(String(p), name)); return { name, isDirectory: st.isDirectory, isFile: st.isFile, isSymbolicLink: st.isSymbolicLink }; }) : names;
  },
  unlinkSync(p) { if (os.remove(String(p))) fail('ENOENT', 'unlink failed', p); },
  symlinkSync(target, p) { if (os.symlink(String(target), String(p))) fail('EIO', 'symlink failed', p); },
  linkSync(a, b) { fail('ENOSYS', 'hard links are not available', b); },
  renameSync(a, b) { if (os.rename(String(a), String(b))) fail('EIO', 'rename failed', a); },
  rmSync(p, opt) {
    p = String(p); const [st, err] = os.lstat(p);
    if (err) { if (opt?.force) return; fail('ENOENT', 'no such file or directory, rm', p); }
    if ((st.mode & S_IFMT) === S_IFDIR) { if (!opt?.recursive) fail('EISDIR', 'is a directory', p); for (const n of fs.readdirSync(p)) fs.rmSync(path.join(p, n), opt); }
    if (os.remove(p)) fail('EIO', 'rm failed', p);
  },
  mkdtempSync(prefix) { for (let i = 0; ; i++) { const p = prefix + Math.random().toString(36).slice(2, 8); if (!fs.existsSync(p)) { fs.mkdirSync(p); return p; } } }
};

// ---- zlib: deflate with LZ77 and the fixed Huffman code (RFC 1951), enough for PNG ----
function adler32(b) { let a = 1, c = 0; for (let i = 0; i < b.length;) { const end = Math.min(b.length, i + 3800); for (; i < end; i++) { a += b[i]; c += a; } a %= 65521; c %= 65521; } return (c << 16 | a) >>> 0; }
const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const LCODE = new Uint16Array(259), DCODE = new Uint8Array(32769);
for (let c = 0; c < 29; c++) for (let l = LBASE[c]; l < (c === 28 ? 259 : LBASE[c + 1]); l++) LCODE[l] = c;
LCODE[258] = 28;
for (let c = 0; c < 30; c++) for (let d = DBASE[c]; d < (c === 29 ? 32769 : DBASE[c + 1]); d++) DCODE[d] = c;
function deflateRaw(src) {
  let out = new Uint8Array(1024 + (src.length >> 1)), len = 0, acc = 0, bits = 0;
  const byte = v => { if (len === out.length) { const o = new Uint8Array(out.length * 2); o.set(out); out = o; } out[len++] = v; };
  const put = (v, n) => { acc |= v << bits; bits += n; while (bits >= 8) { byte(acc & 255); acc >>>= 8; bits -= 8; } };
  const rev = (v, n) => { let r = 0; for (let i = 0; i < n; i++) { r = r << 1 | v & 1; v >>= 1; } return r; };
  const sym = s => { if (s < 144) put(rev(0x30 + s, 8), 8); else if (s < 256) put(rev(0x190 + s - 144, 9), 9); else if (s < 280) put(rev(s - 256, 7), 7); else put(rev(0xc0 + s - 280, 8), 8); };
  put(1, 1); put(1, 2); // one final block, fixed codes
  const head = new Int32Array(1 << 15).fill(-1), prev = new Int32Array(32768), n = src.length;
  const hash = i => (src[i] << 10 ^ src[i + 1] << 5 ^ src[i + 2]) & 0x7fff;
  const insert = i => { if (i + 2 < n) { const h = hash(i); prev[i & 32767] = head[h]; head[h] = i; } };
  for (let i = 0; i < n;) {
    let best = 0, dist = 0;
    if (i + 2 < n) {
      let c = head[hash(i)], chain = 32; const max = Math.min(258, n - i);
      while (c >= 0 && i - c <= 32768 && chain--) {
        if (src[c + best] === src[i + best]) { let l = 0; while (l < max && src[c + l] === src[i + l]) l++; if (l > best) { best = l; dist = i - c; if (l === max) break; } }
        c = prev[c & 32767];
      }
    }
    if (best >= 3) {
      const lc = LCODE[best]; sym(257 + lc); if (LEXT[lc]) put(best - LBASE[lc], LEXT[lc]);
      const dc = DCODE[dist]; put(rev(dc, 5), 5); if (DEXT[dc]) put(dist - DBASE[dc], DEXT[dc]);
      for (let k = 0; k < best; k++) insert(i + k); i += best;
    } else { sym(src[i]); insert(i); i++; }
  }
  sym(256); if (bits) byte(acc & 255);
  return Buffer.from(out.subarray(0, len));
}
// inflate (RFC 1951): stored, fixed and dynamic Huffman blocks
function inflateRaw(src) {
  let pos = 0, acc = 0, bits = 0, out = new Uint8Array(Math.max(1024, src.length * 4)), n = 0;
  const need = k => { while (bits < k) { if (pos >= src.length) throw new Error('unexpected end of deflate data'); acc |= src[pos++] << bits; bits += 8; } };
  const get = k => { need(k); const v = acc & (1 << k) - 1; acc >>>= k; bits -= k; return v; };
  const room = k => { if (n + k > out.length) { const o = new Uint8Array(Math.max(out.length * 2, n + k)); o.set(out.subarray(0, n)); out = o; } };
  const table = lengths => { // canonical Huffman: counts and symbols ordered by code
    const counts = new Uint16Array(16), offs = new Uint16Array(16), syms = new Uint16Array(lengths.length);
    for (const l of lengths) counts[l]++; counts[0] = 0;
    for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + counts[i - 1];
    lengths.forEach((l, s) => { if (l) syms[offs[l]++] = s; }); return { counts, syms };
  };
  const decode = t => { let code = 0, first = 0, index = 0; for (let len = 1; len < 16; len++) { code |= get(1); const c = t.counts[len]; if (code - c < first) return t.syms[index + (code - first)]; index += c; first = (first + c) << 1; code <<= 1; } throw new Error('bad Huffman code'); };
  const fixedL = table(Array.from({ length: 288 }, (_, i) => i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8)), fixedD = table(new Array(30).fill(5));
  const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  for (let last = 0; !last;) {
    last = get(1); const type = get(2);
    if (type === 0) {
      acc = 0; bits = 0; const len = src[pos] | src[pos + 1] << 8; pos += 4; room(len); out.set(src.subarray(pos, pos + len), n); n += len; pos += len; continue;
    }
    let lt = fixedL, dt = fixedD;
    if (type === 2) {
      const hl = get(5) + 257, hd = get(5) + 1, hc = get(4) + 4, cl = new Array(19).fill(0);
      for (let i = 0; i < hc; i++) cl[ORDER[i]] = get(3);
      const ct = table(cl), lens = [];
      while (lens.length < hl + hd) {
        const s = decode(ct);
        if (s < 16) lens.push(s); else if (s === 16) { const r = 3 + get(2), p = lens[lens.length - 1]; for (let i = 0; i < r; i++) lens.push(p); }
        else { const r = s === 17 ? 3 + get(3) : 11 + get(7); for (let i = 0; i < r; i++) lens.push(0); }
      }
      lt = table(lens.slice(0, hl)); dt = table(lens.slice(hl));
    } else if (type !== 1) throw new Error('bad deflate block type');
    for (;;) {
      const s = decode(lt);
      if (s < 256) { room(1); out[n++] = s; } else if (s === 256) break;
      else { const lc = s - 257, len = LBASE[lc] + get(LEXT[lc]), dc = decode(dt), dist = DBASE[dc] + get(DEXT[dc]); room(len); for (let i = 0; i < len; i++, n++) out[n] = out[n - dist]; }
    }
  }
  return Buffer.from(out.subarray(0, n));
}
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; return c; });
const zlib = {
  deflateRawSync: b => deflateRaw(b), inflateRawSync: b => inflateRaw(b), inflateSync: b => inflateRaw(b.subarray(2)),
  deflateSync(b) { const raw = deflateRaw(b), out = Buffer.alloc(raw.length + 6); out[0] = 0x78; out[1] = 0x01; out.set(raw, 2); out.writeUInt32BE(adler32(b), raw.length + 2); return out; },
  crc32(b, c = 0) { c = ~c; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ c >>> 8; return ~c >>> 0; }
};

// ---- crypto: SHA-256 ----
const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
function sha256(parts) {
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19], w = new Int32Array(64);
  const total = parts.reduce((n, b) => n + b.length, 0), tail = Buffer.alloc(((total + 9 + 63) & ~63) - total);
  tail[0] = 0x80; const bitsLen = total * 8; tail.writeUInt32BE(Math.floor(bitsLen / 2 ** 32), tail.length - 8); tail.writeUInt32BE(bitsLen >>> 0, tail.length - 4);
  const block = new Uint8Array(64); let fill = 0;
  const compress = () => {
    for (let i = 0; i < 16; i++) w[i] = block[i * 4] << 24 | block[i * 4 + 1] << 16 | block[i * 4 + 2] << 8 | block[i * 4 + 3];
    for (let i = 16; i < 64; i++) { const a = w[i - 15], b = w[i - 2]; w[i] = (w[i - 16] + ((a >>> 7 | a << 25) ^ (a >>> 18 | a << 14) ^ a >>> 3) + w[i - 7] + ((b >>> 17 | b << 15) ^ (b >>> 19 | b << 13) ^ b >>> 10)) | 0; }
    let [a, b, c, d, e, f, g, k] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (k + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) + (e & f ^ ~e & g) + K[i] + w[i]) | 0;
      const t2 = (((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (a & b ^ a & c ^ b & c)) | 0;
      k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, k].forEach((v, i) => { h[i] = (h[i] + v) | 0; });
  };
  for (const p of [...parts, tail]) for (let i = 0; i < p.length;) { const n = Math.min(64 - fill, p.length - i); block.set(p.subarray(i, i + n), fill); fill += n; i += n; if (fill === 64) { compress(); fill = 0; } }
  const out = Buffer.alloc(32); h.forEach((v, i) => out.writeUInt32BE(v >>> 0, i * 4)); return out;
}
const crypto = {
  createHash(alg) {
    if (alg !== 'sha256') throw new Error('Only sha256 is available');
    const parts = []; const o = { update(d) { parts.push(typeof d === 'string' ? Buffer.from(d) : d); return o; }, digest(enc) { const r = sha256(parts); return enc ? r.toString(enc) : r; } }; return o;
  }
};

// ---- child_process: output goes through temporary files, so a chatty program can't fill a pipe and stall ----
let tmpCount = 0;
function spawnSync(cmd, args = [], opt = {}) {
  const base = (std.getenv('TMPDIR') || '/data/local/tmp') + `/qjs-${os.getpid?.() ?? 0}-${tmpCount++}`;
  const outFd = os.open(base + '.out', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), errFd = os.open(base + '.err', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600);
  let status, error;
  const o = { block: true, usePath: !cmd.includes('/'), stdout: outFd, stderr: errFd }; if (opt.cwd) o.cwd = opt.cwd; if (opt.env) o.env = opt.env;
  try { status = os.exec([cmd, ...args.map(String)], o); }
  catch (e) { error = e; }
  os.close(outFd); os.close(errFd);
  const read = f => { const b = fs.readFileSync(f); fs.unlinkSync(f); return opt.encoding ? b.toString(opt.encoding) : b; };
  const stdout = read(base + '.out'), stderr = read(base + '.err');
  if (opt.stdio === 'inherit') { std.out.puts(String(stdout)); std.err.puts(String(stderr)); }
  if (status < 0) { error = new Error(`${cmd} was stopped by signal ${-status}`); status = null; }
  return { status, stdout, stderr, error };
}
const child_process = {
  spawnSync,
  execFileSync(cmd, args, opt = {}) { const r = spawnSync(cmd, args, opt); if (r.error || r.status !== 0) { const e = new Error(`Command failed: ${cmd} ${args.join(' ')}\n${r.stderr}`); e.status = r.status; throw e; } return r.stdout; }
};

// ---- process and console ----
const format = a => a.map(x => typeof x === 'string' ? x : x instanceof Error ? (x.stack ? x.message + '\n' + x.stack : x.message) : (() => { try { return JSON.stringify(x); } catch { return String(x); } })()).join(' ');
// written through at once: the app reads the build's progress line by line
const out = s => { std.out.puts(s); std.out.flush(); }, err = s => { std.err.puts(s); std.err.flush(); };
const process = {
  argv: ['node', ...scriptArgs.slice(1)], execPath: os.realpath('/proc/self/exe')[0], shim: os.realpath(scriptArgs[0])[0], env: std.getenviron(), platform: 'android', exitCode: 0,
  cwd: () => os.getcwd()[0], exit(code) { std.exit(code ?? process.exitCode ?? 0); },
  stdout: { write(s) { out(String(s)); return true; } }, stderr: { write(s) { err(String(s)); return true; } },
  hrtime: { bigint: () => BigInt(Math.round(os.now() * 1e6)) }, memoryUsage: () => ({ rss: 0, heapUsed: 0 })
};
const console = { log: (...a) => out(format(a) + '\n'), info: (...a) => out(format(a) + '\n'), warn: (...a) => err(format(a) + '\n'), error: (...a) => err(format(a) + '\n'), time() {}, timeEnd() {} };
globalThis.Buffer = Buffer; globalThis.process = process; globalThis.console = console;
globalThis.setImmediate ??= f => os.setTimeout(f, 0);

// ---- require ----
const builtins = { fs, path, zlib, crypto, child_process, os: { tmpdir: () => std.getenv('TMPDIR') || '/data/local/tmp', cpus: () => [{}], EOL: '\n', platform: () => 'android' }, util: { format: (...a) => format(a) } };
const cache = new Map();
function load(file, parent) {
  if (cache.has(file)) return cache.get(file).exports;
  const module = { id: file, filename: file, exports: {}, parent, loaded: false }; cache.set(file, module);
  if (file.endsWith('.json')) { module.exports = JSON.parse(fs.readFileSync(file, 'utf8')); return module.exports; }
  const dir = path.dirname(file), req = makeRequire(dir, module);
  const fn = std.evalScript(`(function (exports, require, module, __filename, __dirname) {${fs.readFileSync(file, 'utf8').replace(/^#!.*/, '')}\n})`, { filename: file });
  fn.call(module.exports, module.exports, req, module, file, dir); module.loaded = true; return module.exports;
}
function makeRequire(dir, parent) {
  const req = id => {
    const name = id.replace(/^node:/, ''); if (name in builtins) return builtins[name];
    const base = path.resolve(dir, id);
    for (const f of [base, base + '.js', base + '.json', base + '/index.js']) if (fs.existsSync(f) && fs.statSync(f).isFile()) return load(f, parent);
    throw new Error(`Cannot find module '${id}' from ${dir}`);
  };
  req.main = mainModule; req.resolve = id => path.resolve(dir, id); return req;
}
let mainModule = null;
const script = path.resolve(scriptArgs[1] || '');
if (!scriptArgs[1]) { std.err.puts('usage: qjs node.mjs <script.js> [args...]\n'); std.exit(2); }
mainModule = { id: '.', filename: script, exports: {}, loaded: false }; cache.set(script, mainModule);
process.argv[1] = script;
try {
  const req = makeRequire(path.dirname(script), null);
  const fn = std.evalScript(`(function (exports, require, module, __filename, __dirname) {${fs.readFileSync(script, 'utf8').replace(/^#!.*/, '')}\n})`, { filename: script });
  fn.call(mainModule.exports, mainModule.exports, req, mainModule, script, path.dirname(script));
} catch (e) { std.err.puts((e?.stack ? e.message + '\n' + e.stack : String(e)) + '\n'); std.exit(1); }
os.setTimeout(() => std.exit(process.exitCode || 0), 0);
