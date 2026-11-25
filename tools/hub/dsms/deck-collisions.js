// Marks every cell under a plank deck in a hand-edited Victory Island map as "bridge over water" (0x73) and walkable
// in the .per files, so the hub stands on the planks and not on the ground below (for bridges lengthened by hand).
// Cells with a railing or fence keep their collision. Backs up each changed .per first.
// Usage: node deck-collisions.js <mapDir> [mapName]
const fs = require('fs');
const path = require('path');

const [DIR, NAME = 'VictoryIsland'] = process.argv.slice(2);
const lines = fs.readFileSync(path.join(DIR, NAME + '.pdsmap'), 'utf8').split(/\r?\n/);
// [width, height], placed from the south-west cell; 171 is the HeartGold flat bridge piece
const PLANKS = { 370: [1, 3], 368: [3, 1], 369: [1, 2], 358: [2, 1], 1245: [1, 1], 1249: [1, 1], 171: [1, 3] };
const FENCE = (id) => id >= 381 && id <= 395;
const deck = new Set(), fenced = new Set();
let mx, my, n = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i] === 'mapstart') { [mx, my] = lines[i + 1].trim().split(' ').map(Number); n = 0; }
  if (lines[i] !== 'tilegrid') continue;
  n++;
  for (let r = 0; r < 32; r++) lines[i + 1 + r].trim().split(/\s+/).map(Number).forEach((t, c) => {
    const x = mx * 32 + c, z = my * 32 + 31 - r;
    if (FENCE(t)) fenced.add(x + ',' + z);
    const s = PLANKS[t]; if (!s) return;
    for (let dz = 0; dz < s[1]; dz++) for (let dx = 0; dx < s[0]; dx++) deck.add((x + dx) + ',' + (z - dz));
  });
}
const pers = {}, stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
let fixed = 0;
for (const k of deck) {
  if (fenced.has(k)) continue;
  const [x, z] = k.split(',').map(Number);
  const file = path.join(DIR, `${NAME}_${String(Math.floor(x / 32)).padStart(2, '0')}_${String(Math.floor(z / 32)).padStart(2, '0')}.per`);
  if (!pers[file]) pers[file] = { buf: fs.readFileSync(file), changed: false };
  const o = ((z % 32) * 32 + (x % 32)) * 2, b = pers[file].buf;
  if (b[o] === 0x73 && b[o + 1] === 0) continue;
  b[o] = 0x73; b[o + 1] = 0; pers[file].changed = true; fixed++;
}
for (const [file, p] of Object.entries(pers)) if (p.changed) { fs.copyFileSync(file, file + '.before-decks-' + stamp); fs.writeFileSync(file, p.buf); }
console.log(`deck cells ${deck.size}, marked as bridge ${fixed}`);
