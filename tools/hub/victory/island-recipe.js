'use strict';
// PC side of building Victory Island on the phone. Reads the island exported by export.js and writes a recipe that
// holds the owner's design only: the meshes as "skeletons", where every corner that comes from a game model is
// replaced by a reference (which model, which corner, where the tile stands), and for every texture and model the
// apicula job that makes it from the player's own cartridge. island-build.js turns the recipe back into the meshes.
// Usage: node tools/hub/victory/island-recipe.js [--data dir] [--out dir, default tools/hub/build/island] [--work dir] [--apicula exe]
//        [--extracts hg=dir,pt=dir,bw=dir,b2=dir]
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { spawnSync } = require('child_process');
const { placements } = require('./mesh');
const { geometry } = require('../dsms/glb-to-obj');
const { jobOutputs, cornerList, place, transform, GROUPS } = require('./island-build');
const repo = path.resolve(__dirname, '../../..');
const out = {
  data: 'C:/Projects/hub-work/victory-island-data', out: path.join(repo, 'tools/hub/build/island'),
  work: 'C:/Projects/hub-work/island-recipe', apicula: process.env.APICULA || 'C:/Projects/Godot pokemon/tools/apicula/apicula.exe',
  map: 'C:/Projects/hub-work/Frontier Terraces/DS Map Studio/FrontierTerracesAligned.pdsmap',
  extracts: 'hg=C:/Projects/hub-work/hg-extract,pt=C:/Projects/hub-work/pt-extract,bw=C:/Projects/hub-work/provenance/bw-extract,b2=C:/Projects/hub-work/b2-extract',
  provenance: 'C:/Projects/hub-work/provenance',
  lib: process.env.DSMS_LIB || 'C:/Projects/hub-work/dsms/app/Pokemon DS Map Studio-2.2/lib',
  java: process.env.JAVA_HOME || 'C:/Program Files/Microsoft/jdk-17.0.20.101-hotspot'
};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i].replace(/^--/, '');
  if (!(key in out) || !process.argv[i + 1]) throw Error('Unknown or incomplete option: ' + process.argv[i]);
  out[key] = process.argv[++i];
}
const extracts = Object.fromEntries(out.extracts.split(',').map(s => s.split('=')));
const run = (exe, args) => { const r = spawnSync(exe, args, { encoding: 'utf8', maxBuffer: 1 << 26 }); if (r.error || r.status) throw Error(exe + ' ' + args.join(' ') + '\n' + (r.error || r.stderr)); return r.stdout; };
const json = (file, v) => fs.writeFileSync(file, JSON.stringify(v, null, 1) + '\n');

// Tiles whose file name doesn't give the model: found by shape against every model of the four games.
const ALIASES = {
  'ship1.obj': 'bw:c03_ship_03', 'ship2.obj': 'b2:c13_ship_01', 'fountain.obj': 'bw:c01fountain_01', 'lighthouse_aligned.obj': 'bw:c5_lhouse_01',
  'StadiumGateGrounded.obj': 'b2:c15_gate_02', 'poke_c_flower_market.obj': 'hg:poke_c_flower'
};
// Tiles drawn from a model in another pose (the ferris wheel): the model as apicula poses it takes their place.
const SWAPS = ['BW_039_c04_fwheel_01_aligned.obj'];
const stem = n => n.replace(/\.obj$/, '').replace(/_aligned$/, '').replace(/^(HG|PT|B2|BW)_\d+_/, '').toLowerCase();

// ---- the ROM files that hold a texture or model name ----
const fileIndex = {};
function filesWith(game, name) {
  if (!fileIndex[game]) fileIndex[game] = fs.readdirSync(extracts[game]).filter(n => /\.(nsbtx|nsbmd)$/.test(n)).sort().map(n => ({ n, b: fs.readFileSync(path.join(extracts[game], n)) }));
  const key = Buffer.alloc(16); key.write(name.slice(0, 16), 'latin1');
  const exact = name.length >= 16 ? key : Buffer.concat([Buffer.from(name, 'latin1'), Buffer.from([0])]);
  return fileIndex[game].filter(f => f.b.includes(exact)).map(f => f.n);
}
// A job is one apicula conversion: the phone runs the same one on its own extraction.
const jobs = {};
function job(game, files) {
  const id = crypto.createHash('sha256').update(game + ':' + files.join('|')).digest('hex').slice(0, 12);
  if (!jobs[id]) {
    jobs[id] = { game, files };
    const dir = path.join(out.work, 'jobs', id);
    if (!fs.existsSync(path.join(dir, '.done'))) {
      fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
      run(out.apicula, ['convert', '-f', 'glb', '--more-textures', '--overwrite', '-o', dir, ...files.map(f => path.join(extracts[game], f))]);
      fs.writeFileSync(path.join(dir, '.done'), '');
    }
  }
  return id;
}
// The model file and the texture sets it needs (the same choice as convert-models.ps1).
function modelJob(game, name) {
  const model = name + '.nsbmd';
  if (!fs.existsSync(path.join(extracts[game], model))) throw Error(`no ${model} in the ${game} extraction`);
  const info = run(out.apicula, ['info', path.join(extracts[game], model)]);
  const remaining = new Set([...info.matchAll(/^\s+(?:Texture|Palette): "?([^\s"]+)"?/gm)].map(m => m[1]));
  const sets = fs.readdirSync(extracts[game]).filter(n => n.endsWith('.nsbtx')).sort();
  const holders = new Map([...remaining].map(r => [r, new Set(filesWith(game, r))]));
  const chosen = [];
  while (remaining.size) {
    let best = null, hits = [];
    for (const s of sets) { const found = [...remaining].filter(r => holders.get(r).has(s)); if (found.length > hits.length) { best = s; hits = found; } }
    if (!best) break; chosen.push(best); for (const h of hits) remaining.delete(h);
  }
  return job(game, [model, ...chosen]);
}

// ---- fit a game model onto a tile: one of 8 turns or mirrors about the vertical, a uniform scale, an offset ----
function fit(tileVerts, corners) {
  const bb = a => [0, 1, 2].map(k => { let lo = Infinity, hi = -Infinity; for (const p of a) { lo = Math.min(lo, p[k]); hi = Math.max(hi, p[k]); } return [lo, hi]; });
  const tb = bb(tileVerts), te = tb.map(r => r[1] - r[0]); let best = null;
  for (let turn = 0; turn < 8; turn++) {
    const c = corners.map(p => transform(p, { turn, s: 1, o: [0, 0, 0] })), cb = bb(c), ce = cb.map(r => r[1] - r[0]);
    const s = te[2] > 1e-3 && ce[2] > 1e-3 ? te[2] / ce[2] : te[0] / ce[0]; if (!isFinite(s) || s <= 0) continue;
    let o = [0, 1, 2].map(k => tb[k][0] - cb[k][0] * s);
    const grid = new Map(), key = p => p.map(x => Math.round(x * 20)).join(',');
    for (const p of tileVerts) grid.set(key(p), p);
    // refine the offset by least squares over the matched pairs, then measure the worst miss
    for (let pass = 0; pass < 2; pass++) {
      let hit = 0, err = 0; const sum = [0, 0, 0];
      for (const p of c) {
        const q = p.map((x, k) => x * s + o[k]), b = q.map(x => Math.round(x * 20)); let m = Infinity, near = null;
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          const t = grid.get([b[0] + dx, b[1] + dy, b[2] + dz].join(',')); if (!t) continue;
          const d = Math.hypot(t[0] - q[0], t[1] - q[1], t[2] - q[2]); if (d < m) { m = d; near = t; }
        }
        if (m < 0.03) { hit++; err = Math.max(err, m); for (let k = 0; k < 3; k++) sum[k] += near[k] - q[k]; }
      }
      const r = { turn, s, o, cover: hit / c.length, err };
      if (pass === 0 && hit) o = o.map((x, k) => x + sum[k] / hit); else if (!best || r.cover > best.cover || r.cover === best.cover && r.err < best.err) best = r;
    }
  }
  return best;
}

function main() {
  fs.mkdirSync(out.work, { recursive: true });
  const build = path.join(out.data, '.build'), groupsOf = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(build, 'tile-groups.json'))).map(t => [t.id, t]));
  const placed = placements(out.map), ids = [...new Set(placed.map(p => p.id))].sort((a, b) => a - b);
  // tile vertices from the map's tileset
  const list = path.join(out.work, 'placed.txt'), dump = path.join(out.work, 'tiles.json');
  fs.writeFileSync(list, ids.join('\n') + '\n');
  const mapLines = fs.readFileSync(out.map, 'utf8').split(/\r?\n/), tileset = path.join(path.dirname(out.map), mapLines[mapLines.indexOf('tileset') + 1].trim());
  const cp = ['Pokemon DS Map Studio-2.2.jar', 'jogamp-fat.jar', 'graphicslib3D.jar'].map(n => path.join(out.lib, n)).join(path.delimiter) + path.delimiter + out.work;
  run(path.join(out.java, 'bin/javac.exe'), ['-nowarn', '-cp', cp, '-d', out.work, path.join(__dirname, 'IslandTiles.java')]);
  run(path.join(out.java, 'bin/java.exe'), ['-Djava.awt.headless=true', '-cp', cp, 'IslandTiles', tileset, list, dump]);
  const tileData = Object.fromEntries(JSON.parse(fs.readFileSync(dump)).map(t => [t.id, t]));

  // ROM tiles: every placed tile that is a game model
  const lib = {}; for (const g of Object.keys(extracts)) lib[g] = new Set(fs.readdirSync(extracts[g]).filter(n => n.endsWith('.nsbmd')).map(n => n.slice(0, -6).toLowerCase()));
  const romTiles = {}, report = [];
  for (const id of ids) {
    const t = tileData[id], alias = ALIASES[t.name];
    const candidates = alias ? [alias.split(':')] : Object.keys(extracts).filter(g => lib[g].has(stem(t.name))).map(g => [g, stem(t.name)]);
    if (!candidates.length) continue;
    const tv = Array.from({ length: t.v.length / 3 }, (_, i) => t.v.slice(i * 3, i * 3 + 3));
    let best = null;
    for (const [game, model] of candidates) {
      const jobId = modelJob(game, model), glbs = jobOutputs(path.join(out.work, 'jobs', jobId)).filter(f => f.endsWith('.glb'));
      const glb = glbs.find(f => f.toLowerCase() === model + '.glb') || glbs[0];
      const corners = cornerList(geometry(path.join(out.work, 'jobs', jobId, glb)));
      const r = fit(tv, corners.map(c => c.p));
      if (r && (!best || r.cover > best.cover)) best = { ...r, game, model, job: jobId, glb };
    }
    report.push(`${id} ${t.name} -> ${best.game}:${best.model} cover ${best.cover.toFixed(4)} worst ${best.err.toFixed(4)} scale ${best.s.toFixed(4)} turn ${best.turn}`);
    if (SWAPS.includes(t.name)) { // drawn in another pose: the whole model replaces it
      const g = geometry(path.join(out.work, 'jobs', best.job, best.glb));
      romTiles[id] = { name: t.name, job: best.job, glb: best.glb, turn: best.turn, s: best.s, o: best.o, swap: true, prefix: best.model + '_', images: [...new Set(cornerList(g).map(c => c.img))] };
      report.push('  swapped for the whole model'); continue;
    }
    if (best.cover < 0.5) { report.push('  not this model: kept as drawn'); continue; }
    romTiles[id] = { name: t.name, job: best.job, glb: best.glb, turn: best.turn, s: best.s, o: best.o };
  }
  json(path.join(out.work, 'rom-tiles.json'), romTiles);

  // ---- skeletons: each position and UV of the exported meshes that one of those models gives becomes a reference ----
  const cell = 0.05, key = (p) => p.map(x => Math.round(x / cell)).join(',');
  const index = new Map(); // grid cell -> [tile id, corner, offset, position, uv, placement]
  const corners = {};
  for (const [id, t] of Object.entries(romTiles))
    corners[id] = cornerList(geometry(path.join(out.work, 'jobs', t.job, t.glb))).map(c => ({ p: transform(c.p, t), uv: c.uv }));
  const inspected = JSON.parse(fs.readFileSync(path.join(build, 'reference/tiles.json'))).tiles;
  const perPlacement = new Map();
  placed.forEach((p, n) => {
    // DS Map Studio moves a tile by its own x/y offset as well
    if (!romTiles[p.id] || romTiles[p.id].swap) return; const o = place(p), shift = inspected[p.id].offset; o[0] += shift[0]; o[1] += shift[1];
    corners[p.id].forEach((c, k) => {
      const q = c.p.map((x, i) => x + o[i]), g = key(q);
      if (!index.has(g)) index.set(g, []); index.get(g).push([p.id, k, o, q, c.uv, n]);
    });
    const qs = corners[p.id].map(c => c.p.map((x, i) => x + o[i])); perPlacement.set(n, { id: p.id, lo: [0, 1, 2].map(k => Math.min(...qs.map(q => q[k])) - 0.05), hi: [0, 1, 2].map(k => Math.max(...qs.map(q => q[k])) + 0.05), left: 0 });
  });
  const swaps = Object.entries(romTiles).filter(([, t]) => t.swap);
  fs.rmSync(out.out, { recursive: true, force: true });
  let literal = 0, unused = 0;
  const materials = new Map(); // group/png -> material
  for (const group of GROUPS) {
    const objFile = path.join(out.data, group, group + '.obj'); if (!fs.existsSync(objFile)) continue;
    const dst = path.join(out.out, group); fs.mkdirSync(dst, { recursive: true });
    const lines = fs.readFileSync(objFile, 'utf8').split(/\r?\n/).filter(Boolean), v = [], vt = [];
    for (const l of lines) { if (l.startsWith('v ')) v.push(l.slice(2).split(' ').map(Number)); else if (l.startsWith('vt ')) vt.push(l.slice(3).split(' ').map(Number)); }
    // the game-model corners at each position (exact up to the export's rounding)
    const cands = v.map(p => {
      const b = p.map(x => Math.round(x / cell)), found = [];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++)
        for (const e of index.get([b[0] + dx, b[1] + dy, b[2] + dz].join(',')) || []) if (Math.hypot(e[3][0] - p[0], e[3][1] - p[1], e[3][2] - p[2]) <= 0.03) found.push(e);
      return found.sort((a, b) => Math.hypot(...a[3].map((x, k) => x - p[k])) - Math.hypot(...b[3].map((x, k) => x - p[k])));
    });
    const vRef = new Array(v.length).fill(null), tRef = new Array(vt.length).fill(null), usedV = new Set(), usedT = new Set();
    const dropped = l => swaps.some(([, t]) => t.drop ? t.drop.includes(l) : l.startsWith(t.prefix));
    let current = '';
    const faces = [];
    for (const l of lines) {
      if (l.startsWith('usemtl ')) current = l.slice(7);
      if (!l.startsWith('f ') || dropped(current)) continue;
      const f = l.slice(2).split(' ').map(c => c.split('/').map(x => +x - 1)); faces.push(f);
      for (const [vi, ti] of f) {
        usedV.add(vi); if (ti >= 0) usedT.add(ti);
        if (!(ti >= 0) || tRef[ti] && vRef[vi]) continue;
        const uv = vt[ti], e = cands[vi].find(e => Math.abs(e[4][0] - uv[0]) < 2e-3 && Math.abs(e[4][1] - uv[1]) < 2e-3);
        if (e) { vRef[vi] ??= e; tRef[ti] ??= e; }
      }
    }
    for (let i = 0; i < v.length; i++) if (!vRef[i] && cands[i].length) vRef[i] = cands[i][0];
    // a normal is recomputed on the phone when every face using it is made of game-model corners
    const nState = new Map();
    for (const f of faces) { const ni = f[0][2]; if (!(ni >= 0)) continue; const rom = f.every(([vi]) => vRef[vi]); nState.set(ni, (nState.get(ni) ?? true) && rom); }
    let vi = 0, ti = 0, ni = 0; const skel = []; current = '';
    for (const l of lines) {
      if (l.startsWith('v ')) { const i = vi++, e = vRef[i]; if (!usedV.has(i)) { skel.push('v 0 0 0'); unused++; } else if (e) skel.push(`rv ${e[0]} ${e[1]} ${e[2].join(' ')}`); else { skel.push(l); literal++; const p = v[i]; for (const s of perPlacement.values()) if (p.every((x, k) => x >= s.lo[k] && x <= s.hi[k])) s.left++; } }
      else if (l.startsWith('vt ')) { const i = ti++, e = tRef[i]; skel.push(!usedT.has(i) ? 'vt 0 0' : e ? `rt ${e[0]} ${e[1]}` : l); }
      else if (l.startsWith('vn ')) { const i = ni++; skel.push(nState.get(i) ? 'rn' : nState.has(i) ? l : 'vn 0 0 1'); }
      else { if (l.startsWith('usemtl ')) current = l.slice(7); if (!(l.startsWith('f ') && dropped(current))) skel.push(l); }
    }
    // swapped models: drawn whole from the game model, as apicula poses it
    for (const [id, t] of swaps) placed.forEach((p, n) => { if (p.id === +id && (groupsOf[p.id]?.group || 'terrain') === group) { const o = place(p), sh = inspected[p.id].offset; skel.push(`rf ${id} ${o[0] + sh[0]} ${o[1] + sh[1]} ${o[2]}`); } });
    fs.writeFileSync(path.join(dst, group + '.skel'), skel.join('\n') + '\n');
    for (const n of fs.readdirSync(path.join(out.data, group))) if (/\.json$/.test(n)) fs.copyFileSync(path.join(out.data, group, n), path.join(dst, n));
    // materials: the MTL ships; each texture comes from the cartridge
    let mtl = fs.readFileSync(path.join(out.data, group, group + '.mtl'), 'utf8').replace(/\r\n/g, '\n');
    for (const [id, t] of swaps) for (const img of t.images) { const m = t.prefix + img.replace(/\.png$/, ''); if (!mtl.includes('newmtl ' + m + '\n')) mtl += `\nnewmtl ${m}\nmap_Kd ${m}.png\nmap_d ${m}.png\n`; }
    fs.writeFileSync(path.join(dst, group + '.mtl'), mtl);
    for (const m of mtl.matchAll(/^map_Kd (.+)$/gm)) if (!swaps.some(([, t]) => t.drop?.includes(m[1].trim().replace(/.png$/, '')))) materials.set(group + '/' + m[1].trim(), m[1].trim());
  }
  for (const [n, s] of perPlacement) if (s.left) report.push(`placement ${n} (tile ${s.id} ${romTiles[s.id].name}): ${s.left} positions inside it kept as drawn`);
  report.push(`positions kept as drawn: ${literal}; unused positions blanked: ${unused}`);

  // ---- textures: the apicula job and output picture for each material's texture ----
  const { pixels } = require('../qjs/compare');
  const matched = JSON.parse(fs.readFileSync(path.join(out.provenance, 'tileset-match.json'))).matched;
  const substitutes = JSON.parse(fs.readFileSync(path.join(__dirname, 'substitutes.json'))).textures;
  const textures = {}, missing = [];
  for (const [file, png] of materials) {
    const swapped = swaps.find(([, t]) => png.startsWith(t.prefix) && t.images.includes(png.slice(t.prefix.length)));
    if (swapped) { textures[file] = { job: swapped[1].job, png: png.slice(swapped[1].prefix.length), from: 'model' }; continue; }
    const sub = substitutes[file] || Object.entries(substitutes).find(([k]) => path.basename(k) === png)?.[1];
    let source = sub?.rom ? sub.rom + '.png' : matched[png]?.[0];
    if (sub === null || sub?.rom === null) source = null;
    if (!source) { missing.push(file); continue; }
    // a substitute may name a texture the dump has no picture of (a frame set's first frame): then it's found by name
    const [game, name] = source.split(':'), dumped = path.join(out.provenance, 'tex-' + game, name), want = fs.existsSync(dumped) ? pixels(dumped) : null;
    // the combined dump numbers repeated names (gake1_16 is the sixth gake1_1): try the name without 1 to 3 of its last digits
    const base = name.replace(/\.png$/, ''), names = [base];
    for (let k = 1; k <= 3 && /\d$/.test(base.slice(0, base.length - k + 1)); k++) names.push(base.slice(0, -k));
    for (const n of [...names]) if (/_\d+$/.test(n)) names.push(n.replace(/_(\d+)$/, '.$1')); // frames: apicula writes name.1 as name_1
    const files = [...new Set(names.flatMap(n => filesWith(game, n)))];
    let hit = null;
    for (const f of files.sort((a, b) => a.endsWith('.nsbtx') === b.endsWith('.nsbtx') ? a.localeCompare(b) : a.endsWith('.nsbtx') ? -1 : 1)) {
      const id = job(game, [f]), dir = path.join(out.work, 'jobs', id);
      const pngOut = jobOutputs(dir).filter(n => n.endsWith('.png')).find(n => want && pixels(path.join(dir, n)) === want);
      if (pngOut) { hit = { job: id, png: pngOut, from: source }; break; }
    }
    if (!hit && files.length > 1) { // a texture whose palette is in another file: convert them together
      const id = job(game, files.sort()), dir = path.join(out.work, 'jobs', id);
      const pngOut = jobOutputs(dir).filter(n => n.endsWith('.png')).find(n => want && pixels(path.join(dir, n)) === want);
      if (pngOut) hit = { job: id, png: pngOut, from: source };
    }
    if (!hit) for (const f of files.filter(f => f.endsWith('.nsbtx')).sort()) { // animated textures: the same frame by name (another palette pairing)
      const id = job(game, [f]), n = base + '.png';
      if (fs.existsSync(path.join(out.work, 'jobs', id, n))) { hit = { job: id, png: n, from: source + ' (by name)' }; report.push('texture ' + file + ': ' + source + ' taken by name from ' + f); break; }
    }
    if (hit) textures[file] = hit; else missing.push(file + ' (' + source + ': no file set gives it)');
  }
  // Where the island's picture isn't the cartridge's (a lighting or palette edit, a look-alike), the recipe keeps the
  // difference, which the phone adds to the cartridge's picture; a picture with no cartridge base at all is the
  // owner's own art and ships as it is.
  const { decode, encode } = require('./png');
  let edits = 0, art = 0;
  for (const [file] of materials) {
    const orig = path.join(out.data, file), t = textures[file];
    if (!fs.existsSync(orig)) continue; // a swapped model's own texture
    if (!t) { fs.mkdirSync(path.dirname(path.join(out.out, 'art', file)), { recursive: true }); fs.copyFileSync(orig, path.join(out.out, 'art', file)); textures[file] = { art: 'art/' + file }; art++; continue; }
    const diff = editOf(decode(fs.readFileSync(path.join(out.work, 'jobs', t.job, t.png))), decode(fs.readFileSync(orig)));
    if (!diff) continue;
    fs.mkdirSync(path.dirname(path.join(out.out, 'edits', file)), { recursive: true });
    fs.writeFileSync(path.join(out.out, 'edits', file), encode(diff)); t.edit = 'edits/' + file; edits++;
  }
  report.push(`textures: ${Object.keys(textures).length}; ${edits} with an edit over the cartridge's picture, ${art} of the owner's own art (${missing.join(', ')})`);
  // only the jobs still in use
  const usedJobs = new Set([...Object.values(romTiles).map(t => t.job), ...Object.values(textures).map(t => t.job)]);
  json(path.join(out.out, 'recipe.json'), { note: 'Made by tools/hub/victory/island-recipe.js; built by island-build.js. Names and numbers only: no game data.',
    jobs: Object.fromEntries(Object.entries(jobs).filter(([id]) => usedJobs.has(id))), tiles: romTiles, textures });
  for (const f of ['walk.json', 'cells.json', 'signs.json']) fs.copyFileSync(path.join(out.data, f), path.join(out.out, f));
  fs.writeFileSync(path.join(out.work, 'recipe-report.txt'), report.join('\n') + '\n');
  console.log(report.join('\n'));
}
// The difference that turns a cartridge picture (scaled to the island picture's size, nearest pixel) into the island's,
// per channel modulo 256; null when they already match. island-build.js adds it back (applyEdit).
function editOf(base, want) {
  const data = Buffer.alloc(want.w * want.h * 4); let same = true;
  for (let y = 0; y < want.h; y++) for (let x = 0; x < want.w; x++) {
    const i = (y * want.w + x) * 4, j = (Math.floor(y * base.h / want.h) * base.w + Math.floor(x * base.w / want.w)) * 4;
    for (let c = 0; c < 4; c++) { data[i + c] = (want.data[i + c] - base.data[j + c]) & 255; if (data[i + c]) same = false; }
  }
  return same ? null : { w: want.w, h: want.h, data };
}
if (require.main === module) main();
module.exports = { fit, ALIASES };
