// Compares two hub data folders file by file: PNGs by their decoded image (header and pixel rows, so a different
// deflate doesn't count), everything else byte for byte. Used to check the phone's build against the PC's.
// Usage: node tools/hub/qjs/compare.js <pc folder> <phone folder>
'use strict';
const fs = require('fs'), path = require('path');

// The decoded RGBA picture, so PNGs that differ only in filters, palette layout or deflate compare equal.
function pixels(file) {
  const im = require('../victory/png').decode(fs.readFileSync(file));
  return im.w + 'x' + im.h + ':' + require('crypto').createHash('sha256').update(im.data).digest('hex');
}
function list(dir, base = dir, out = []) {
  for (const n of fs.readdirSync(dir).sort()) { const f = path.join(dir, n); if (fs.statSync(f).isDirectory()) list(f, base, out); else out.push(path.relative(base, f).split(path.sep).join('/')); }
  return out;
}
if (require.main === module) {
  const [a, b] = process.argv.slice(2), la = list(a), lb = new Set(list(b));
  let same = 0; const differ = [], missing = la.filter(f => !lb.has(f)), extra = [...lb].filter(f => !la.includes(f));
  for (const f of la) {
    if (!lb.has(f)) continue;
    const x = path.join(a, f), y = path.join(b, f);
    const eq = f.endsWith('.png') ? pixels(x) === pixels(y) : fs.readFileSync(x).equals(fs.readFileSync(y));
    if (eq) same++; else differ.push(f);
  }
  console.log(`${same} same, ${differ.length} different, ${missing.length} missing, ${extra.length} extra`);
  for (const [k, v] of [['different', differ], ['missing', missing], ['extra', extra]]) for (const f of v.slice(0, 30)) console.log(k + ' ' + f);
  process.exitCode = differ.length || missing.length ? 1 : 0;
}
module.exports = { pixels, list };
