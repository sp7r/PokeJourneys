// Converts every converted model under the data directory into an OBJ tile folder and writes the import list.
// Scales come from the hub layout where the model is used, otherwise a per-folder default (native Black 2 size).
// Usage: node model-tiles.js <dataDir> <world.json> <outDir>
const fs = require('fs');
const path = require('path');
const { convert } = require('./glb-to-obj.js');

const [DATA, WORLD, OUT] = process.argv.slice(2);
const world = JSON.parse(fs.readFileSync(WORLD, 'utf8'));
// sizes chosen for Victory Island: the Pokeathlon Dome fills the stadium circle
const OVERRIDE = { poke_c_dome2: 1.1, poke_c_dome: 1.1 };
// parts of one building: centred on the main part's footprint, so both tiles go on the same cell (the dome's lobe ring)
const SAME_FRAME = { poke_c_dome: 'poke_c_dome2' };
const used = { ...Object.fromEntries(Object.entries(OVERRIDE).map(([k, v]) => [k + '.glb', v])) };
for (const m of world.models) used[path.basename(m.file)] = used[path.basename(m.file)] || m.scale || 1;
const FOLDERS = { 'buildings-glb': 0.67, 'houses-glb': 0.67, 'decor-glb': 0.57, 'props-glb': 0.67, 'pwt-glb': 0.67, 'gen4-glb/hg': 0.67, 'gen4-glb/hg2': 0.67 };
const list = [], report = [], seen = new Set();
for (const [folder, fallback] of Object.entries(FOLDERS)) {
  const dir = path.join(DATA, folder);
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir).sort()) {
    const glb = path.join(dir, name, name + '.glb');
    if (!fs.existsSync(glb) || /^m_/.test(name) || seen.has(name)) continue; // m_* are whole map chunks, not props
    seen.add(name);
    const scale = used[name + '.glb'] || fallback;
    try {
      let frame = null;
      if (SAME_FRAME[name]) { const main = SAME_FRAME[name], mainGlb = path.join(dir, main, main + '.glb');
        frame = convert(mainGlb, path.join(OUT, main), main, used[main + '.glb'] || fallback, 20).bounds; }
      const r = convert(glb, path.join(OUT, name), name, scale, 20, 0, frame);
      list.push([path.join(OUT, name).split(path.sep).join('/'), name + '.obj', r.w, r.h].join('\t'));
      report.push(`${folder}/${name}\t${r.w}x${r.h}\theight ${r.height.toFixed(1)}\tscale ${scale}`);
    } catch (e) { report.push(`${folder}/${name}\tSKIPPED ${e.message}`); }
  }
}
// turned copies for models the layout uses at 90 degrees (arches across north-south paths)
for (const [name, folder] of [['c01arch_01', 'decor-glb']]) {
  const r = convert(path.join(DATA, folder, name, name + '.glb'), path.join(OUT, name + '_r90'), name + '_r90', used[name + '.glb'] || 0.8, 20, 90);
  list.push([path.join(OUT, name + '_r90').split(path.sep).join('/'), name + '_r90.obj', r.w, r.h].join('\t'));
  report.push(`${folder}/${name} turned 90\t${r.w}x${r.h}`);
}
// c_cruiser_port_0 is a whole harbour map, not a prop
fs.writeFileSync(path.join(OUT, 'import-list.txt'), list.filter((l) => !l.includes('c_cruiser_port_0')).join('\n') + '\n');
console.log(report.join('\n'));
console.log(`${list.length} models converted`);
