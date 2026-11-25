'use strict';
// Compares two island exports mesh by mesh, as sets of triangles per material (positions to 1/100 tile, UVs to
// 1/200), so a rebuilt island can be checked against DS Map Studio's export whatever the vertex order.
// Usage: node tools/hub/victory/compare-meshes.js <data a> <data b> [material prefix to skip ...]
const fs = require('fs'), path = require('path');
const { GROUPS } = require('./island-build');

function triangles(file, skip) {
  const v = [], vt = [], out = new Map(); let mat = '';
  for (const l of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (l.startsWith('v ')) v.push(l.slice(2).split(' ').map(Number));
    else if (l.startsWith('vt ')) vt.push(l.slice(3).split(' ').map(Number));
    else if (l.startsWith('usemtl ')) mat = l.slice(7);
    else if (l.startsWith('f ') && !skip.some(s => mat.startsWith(s))) {
      const c = l.slice(2).split(' ').map(x => x.split('/').map(Number)).map(([a, b]) => v[a - 1].map(x => Math.round(x * 100)).join(',') + '|' + (b ? vt[b - 1].map(x => Math.round(x * 200)).join(',') : ''));
      for (let i = 1; i + 1 < c.length; i++) {
        const tri = [c[0], c[i], c[i + 1]], k = tri.indexOf([...tri].sort()[0]), key = mat + ' ' + [...tri.slice(k), ...tri.slice(0, k)].join(' ');
        out.set(key, (out.get(key) || 0) + 1);
      }
    }
  }
  return out;
}
if (require.main === module) {
  const [a, b, ...skip] = process.argv.slice(2); let bad = 0;
  for (const g of GROUPS) {
    const fa = path.join(a, g, g + '.obj'), fb = path.join(b, g, g + '.obj'); if (!fs.existsSync(fa)) continue;
    const ta = triangles(fa, skip), tb = triangles(fb, skip); let only = 0, onlyB = 0, total = 0; const mats = new Map();
    for (const [k, n] of ta) { total += n; const m = n - (tb.get(k) || 0); if (m > 0) { only += m; const mt = k.split(' ')[0]; mats.set(mt, (mats.get(mt) || 0) + m); } }
    for (const [k, n] of tb) { const m = n - (ta.get(k) || 0); if (m > 0) onlyB += m; }
    console.log(`${g}: ${total} triangles, ${only} only in the first, ${onlyB} only in the second` + [...mats].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([m, n]) => `\n  ${m}: ${n}`).join(''));
    bad += only + onlyB;
  }
  process.exitCode = bad ? 1 : 0;
}
module.exports = { triangles };
