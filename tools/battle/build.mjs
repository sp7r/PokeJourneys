import {build} from 'esbuild';
import {mkdir, copyFile, readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const output = resolve(process.argv[2] || resolve(root, '../../app/build/generated/domeAssets'), 'dome');
await mkdir(output, {recursive: true});
await build({entryPoints: {battle: resolve(root, 'browser.mjs'), controls: resolve(root, 'controls.mjs')},
  outdir: output, bundle: true, minify: true, format: 'iife', platform: 'browser', target: 'chrome90', legalComments: 'eof'});
await copyFile(resolve(root, 'style.css'), resolve(output, 'style.css'));
const licenses = [];
for (const name of ['@pkmn/sim', '@pkmn/randoms', '@pkmn/sets', '@pkmn/streams', '@pkmn/view', '@pkmn/protocol', 'ts-chacha20']) {
  const directory = resolve(root, 'node_modules', name);
  const pkg = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
  let license;
  for (const filename of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
    try { license = await readFile(resolve(directory, filename), 'utf8'); break; } catch {}
  }
  if (!license && name.startsWith('@pkmn/')) license = await readFile(resolve(root, '../../third_party/licenses/pkmn-MIT.txt'), 'utf8');
  if (!license) throw new Error(`Missing license for ${name}`);
  licenses.push(`=== ${name} ${pkg.version} (${pkg.license})\n\n${license}`);
}
await writeFile(resolve(output, 'licenses.txt'), licenses.join('\n\n'));
console.log(`Battle Dome assets: ${output}`);
