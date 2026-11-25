'use strict';
// Builds Victory Island's meshes and textures from the player's own cartridges, on the phone (under QuickJS, see
// tools/hub/qjs/node.mjs) or on a PC: runs the recipe's apicula jobs on the cartridges' extractions, fills the
// skeleton meshes' game-model corners from the converted models, and copies each texture from its job.
// Usage: node island-build.js --recipe <hub/victory/data/island> --extracts hg=dir,pt=dir,bw=dir,b2=dir
//        --apicula <exe> --work <dir> --data <hub data dir>
const fs = require('fs'), path = require('path');
const { spawnSync } = require('child_process');
const { geometry } = require('../dsms/glb-to-obj');
const GROUPS = ['terrain', 'buildings', 'decorations', 'deck', 'deck2'];

const jobOutputs = dir => fs.readdirSync(dir).filter(n => !n.startsWith('.')).sort();
// Every drawn corner of a converted model, in tile units and DS Map Studio's axes (x east, y north, z up).
function cornerList(g) {
  const images = (g.gltf.materials || []).map(m => { const t = m.pbrMetallicRoughness?.baseColorTexture; return t === undefined ? null : g.gltf.images[g.gltf.textures[t.index].source].uri; });
  const out = [];
  for (const [m, f] of g.faces) {
    if (!images[m]) continue;
    for (const [vi, ti] of f) { const [x, y, z] = g.verts[vi]; out.push({ p: [x / 16, -z / 16, y / 16], uv: g.uvs[ti], img: images[m] }); }
  }
  return out;
}
// turn: 0-7, bit 2 swaps x and y, bit 1 mirrors x, bit 0 mirrors y; then the scale and the offset.
function transform([x, y, z], { turn, s, o }) {
  const sw = turn >> 2 & 1, fx = turn >> 1 & 1 ? -1 : 1, fy = turn & 1 ? -1 : 1;
  return [(sw ? y : x) * fx * s + o[0], (sw ? x : y) * fy * s + o[1], z * s + o[2]];
}
// Where DS Map Studio's OBJ writer puts a tile placed on map tile [x, y] (y north) at a height.
const place = p => [p.tile[0] - 16, 15 - p.tile[1], p.height];
function faceNormal(a, b, c) {
  const u = [0, 1, 2].map(k => b[k] - a[k]), w = [0, 1, 2].map(k => c[k] - a[k]);
  const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], l = Math.hypot(...n) || 1;
  return n.map(x => x / l);
}
const fmt = x => { const s = x.toFixed(4).replace(/\.?0+$/, ''); return s === '-0' ? '0' : s; };

function apiculaJob(apicula, extract, files, dir) {
  if (fs.existsSync(path.join(dir, '.done'))) return;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const r = spawnSync(apicula, ['convert', '-f', 'glb', '--more-textures', '--overwrite', '-o', dir, ...files.map(f => path.join(extract, f))], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.error || r.status) throw Error('apicula convert failed for ' + files.join(', ') + '\n' + (r.error || r.stderr));
  fs.writeFileSync(path.join(dir, '.done'), '');
}

// A cartridge picture plus the recipe's edit (island-recipe.js editOf): the island's picture, as a PNG.
function applyEdit(baseFile, editFile) {
  const { decode, encode } = require('./png'), base = decode(fs.readFileSync(baseFile)), edit = decode(fs.readFileSync(editFile));
  const data = Buffer.alloc(edit.w * edit.h * 4);
  for (let y = 0; y < edit.h; y++) for (let x = 0; x < edit.w; x++) {
    const i = (y * edit.w + x) * 4, j = (Math.floor(y * base.h / edit.h) * base.w + Math.floor(x * base.w / edit.w)) * 4;
    for (let c = 0; c < 4; c++) data[i + c] = (base.data[j + c] + edit.data[i + c]) & 255;
  }
  return encode({ w: edit.w, h: edit.h, data });
}

function build(args) {
  const recipe = JSON.parse(fs.readFileSync(path.join(args.recipe, 'recipe.json'), 'utf8'));
  const extracts = Object.fromEntries(args.extracts.split(',').map(s => s.split('=')));
  const jobsDir = path.join(args.work, 'jobs');
  for (const [id, j] of Object.entries(recipe.jobs)) apiculaJob(args.apicula, extracts[j.game], j.files, path.join(jobsDir, id));
  const corners = {};
  for (const [id, t] of Object.entries(recipe.tiles)) corners[id] = cornerList(geometry(path.join(jobsDir, t.job, t.glb))).map(c => ({ p: transform(c.p, t), uv: c.uv, img: c.img }));
  for (const group of GROUPS) {
    const src = path.join(args.recipe, group), dst = path.join(args.data, group);
    if (!fs.existsSync(path.join(src, group + '.skel'))) continue;
    fs.rmSync(dst, { recursive: true, force: true }); fs.mkdirSync(dst, { recursive: true });
    // rv <tile> <corner> <dx> <dy> <dz>: a game model's corner position; rt <tile> <corner>: its UV;
    // rn: the normal of the first face that uses it; rf <tile> <dx> <dy> <dz>: the whole model, appended.
    const lines = fs.readFileSync(path.join(src, group + '.skel'), 'utf8').split('\n').filter(Boolean);
    const outLines = [], v = [], tail = [];
    let nv = 0, nt = 0, nn = 0;
    for (const line of lines) {
      const p = line.split(' ');
      if (p[0] === 'rv') { const c = corners[p[1]][+p[2]]; if (!c) throw Error(`${group}: tile ${p[1]} has no corner ${p[2]}`); const q = [0, 1, 2].map(k => c.p[k] + +p[3 + k]); v.push(q); outLines.push(`v ${q.map(fmt).join(' ')}`); nv++; }
      else if (p[0] === 'v') { v.push([+p[1], +p[2], +p[3]]); outLines.push(line); nv++; }
      else if (p[0] === 'rt') { const c = corners[p[1]][+p[2]]; outLines.push(`vt ${fmt(c.uv[0])} ${fmt(c.uv[1])}`); nt++; }
      else if (p[0] === 'vt') { outLines.push(line); nt++; }
      else if (p[0] === 'rn') { outLines.push({ normal: nn++ }); }
      else if (p[0] === 'vn') { outLines.push(line); nn++; }
      else if (p[0] === 'rf') tail.push(p);
      else outLines.push(line);
    }
    // normals from the faces
    const normal = new Map();
    for (const l of outLines) {
      if (typeof l !== 'string' || !l.startsWith('f ')) continue;
      const f = l.slice(2).split(' ').map(c => c.split('/').map(x => +x - 1)), ni = f[0][2];
      if (ni >= 0 && !normal.has(ni)) { const [a, b, c] = f.map(([i]) => v[i]); normal.set(ni, faceNormal(a, b, c)); }
    }
    const body = outLines.map(l => typeof l === 'string' ? l : `vn ${(normal.get(l.normal) || [0, 0, 1]).map(fmt).join(' ')}`);
    // whole models: their corners go after everything else, so existing indices stay valid
    for (const [, tile, dx, dy, dz] of tail) {
      const cs = corners[tile], prefix = recipe.tiles[tile].prefix, byMat = new Map();
      for (let i = 0; i + 2 < cs.length; i += 3) { const m = prefix + cs[i].img.replace(/\.png$/i, ''); if (!byMat.has(m)) byMat.set(m, []); byMat.get(m).push(i); }
      for (const [m, tris] of byMat) {
        body.push('usemtl ' + m);
        for (const i of tris) {
          const q = [0, 1, 2].map(k => cs[i + k].p.map((x, j) => x + [+dx, +dy, +dz][j]));
          for (const x of q) body.push(`v ${x.map(fmt).join(' ')}`);
          for (let k = 0; k < 3; k++) body.push(`vt ${fmt(cs[i + k].uv[0])} ${fmt(cs[i + k].uv[1])}`);
          body.push(`vn ${faceNormal(...q).map(fmt).join(' ')}`);
          nv += 3; nt += 3; nn++;
          body.push(`f ${nv - 2}/${nt - 2}/${nn} ${nv - 1}/${nt - 1}/${nn} ${nv}/${nt}/${nn}`);
        }
      }
    }
    fs.writeFileSync(path.join(dst, group + '.obj'), body.join('\n') + '\n');
    for (const name of fs.readdirSync(src)) if (!name.endsWith('.skel')) fs.copyFileSync(path.join(src, name), path.join(dst, name));
  }
  for (const [file, t] of Object.entries(recipe.textures)) {
    fs.mkdirSync(path.dirname(path.join(args.data, file)), { recursive: true });
    if (t.art) fs.copyFileSync(path.join(args.recipe, t.art), path.join(args.data, file)); // the owner's own art
    else if (t.edit) fs.writeFileSync(path.join(args.data, file), applyEdit(path.join(jobsDir, t.job, t.png), path.join(args.recipe, t.edit)));
    else fs.copyFileSync(path.join(jobsDir, t.job, t.png), path.join(args.data, file));
  }
  console.log(`Island: ${Object.keys(recipe.jobs).length} apicula jobs, ${Object.keys(recipe.tiles).length} game models, ${Object.keys(recipe.textures).length} textures`);
}

if (require.main === module) {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
  for (const k of ['recipe', 'extracts', 'apicula', 'work', 'data']) if (!args[k]) throw Error('missing --' + k);
  build(args);
}
module.exports = { build, jobOutputs, cornerList, transform, place, apiculaJob, GROUPS, fmt };
