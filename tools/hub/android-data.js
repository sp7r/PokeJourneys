// Gathers what the hub reads (config, character sheets, the exported Victory Island with its collision files and
// textures, ground textures and models) into C:/Projects/hub-work/android-data, laid out as the Android launcher
// expects, and with --push copies it to a connected device (adb) into the app's private storage
// (/data/data/journeys.hub.game/files/data): pushed to /data/local/tmp first, then copied in with run-as, which works
// for debug builds (adb may not write into other apps' folders on Android 11 and later). Install the APK first.
// Game files never go into the APK or the repository.
// Usage (repository root): node tools/hub/android-data.js [--push]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '../..'), WORK = 'C:/Projects/hub-work', OUT = path.join(WORK, 'android-data');
const CONFIG = path.join(REPO, 'hub/game/config'), ART = path.join(REPO, 'assets/creator');
const world = JSON.parse(fs.readFileSync(path.join(CONFIG, 'world.json'), 'utf8'));
const character = JSON.parse(fs.readFileSync(path.join(CONFIG, 'character.json'), 'utf8'));

const files = []; // [from, to]
const add = (from, to) => { if (!fs.existsSync(from)) throw new Error('missing ' + from); files.push([from, to]); };
const data = (rel) => add(path.join(WORK, rel), path.join('data', rel));
for (const f of ['world.json', 'character.json']) add(path.join(CONFIG, f), path.join('data/config', f));
for (const layer of character.layers) for (const motion of ['walk', 'run']) {
  const rel = layer.replace('{motion}', motion); add(path.join(ART, rel), path.join('data/art', rel));
}
for (const rel of Object.values(world.ground.textures)) data(rel);
const tiles = world.ground.tiles;
if (tiles) {
  data(tiles.obj);
  const objDir = path.dirname(tiles.obj);
  for (const line of fs.readFileSync(path.join(WORK, tiles.obj), 'utf8').split(/\r?\n/)) {
    if (!line.startsWith('mtllib ')) continue;
    const mtl = path.posix.join(objDir, line.slice(7).trim()); data(mtl);
    for (const m of fs.readFileSync(path.join(WORK, mtl), 'utf8').split(/\r?\n/)) {
      const t = m.match(/^\s*map_(?:Kd|d)\s+(.+)$/); if (t) data(path.posix.join(objDir, t[1].trim()));
    }
    break; // the materials come right after the header
  }
  for (let my = 0; my < tiles.maps[1]; my++) for (let mx = 0; mx < tiles.maps[0]; mx++)
    data(`${tiles.per}_${String(mx).padStart(2, '0')}_${String(my).padStart(2, '0')}.per`);
}
for (const m of world.models) { // a model and the textures beside it
  const dir = path.dirname(m.file);
  for (const f of fs.readdirSync(path.join(WORK, dir))) if (/\.(glb|png)$/i.test(f)) data(path.posix.join(dir, f));
}

fs.rmSync(OUT, { recursive: true, force: true });
const seen = new Set(); let bytes = 0;
for (const [from, to] of files) {
  if (seen.has(to)) continue; seen.add(to);
  const dest = path.join(OUT, to); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(from, dest); bytes += fs.statSync(from).size;
}
console.log(`staged ${seen.size} files, ${(bytes / 1e6).toFixed(1)} MB in ${OUT}`);

if (process.argv.includes('--push')) {
  const adb = process.env.ADB || path.join(process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA, 'Android/Sdk'), 'platform-tools/adb');
  const tmp = '/data/local/tmp/journeys-hub', app = 'journeys.hub.game';
  execFileSync(adb, ['shell', 'rm', '-rf', tmp], { stdio: 'inherit' });
  execFileSync(adb, ['shell', 'mkdir', '-p', tmp], { stdio: 'inherit' });
  execFileSync(adb, ['push', path.join(OUT, 'data'), tmp + '/'], { stdio: 'inherit' });
  execFileSync(adb, ['shell', 'chmod', '-R', 'a+rX', tmp], { stdio: 'inherit' });
  execFileSync(adb, ['shell', `run-as ${app} sh -c 'rm -rf files/data && mkdir -p files && cp -r ${tmp}/data files/'`], { stdio: 'inherit' });
  execFileSync(adb, ['shell', 'rm', '-rf', tmp], { stdio: 'inherit' });
  console.log('copied into ' + app + ' files/data');
}
