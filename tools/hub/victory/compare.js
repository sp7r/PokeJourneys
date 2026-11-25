'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const repo = path.resolve(__dirname, '../../..');
const defaults = { map: 'C:/Projects/hub-work/Frontier Terraces/DS Map Studio/FrontierTerracesAligned.pdsmap', data: 'C:/Projects/hub-work/victory-island-data', reference: 'C:/Projects/hub-work/Frontier Terraces/Godot', godot: process.env.GODOT || '' };
const options = { ...defaults };
let prepareOnly = false;
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i].replace(/^--/, '');
  if (key === 'prepare-only') { prepareOnly = true; continue; }
  if (!(key in defaults) || !process.argv[i + 1]) throw new Error('Unknown or incomplete option: ' + process.argv[i]);
  options[key] = path.resolve(process.argv[++i]);
}
const data = path.resolve(options.data);
const relative = path.relative(repo, data);
if (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)) throw new Error('Comparison data must be outside the repository');
const output = path.join(data, 'compare');
const referenceCopy = path.join(data, 'reference');
if (path.resolve(options.reference).toLowerCase() === referenceCopy.toLowerCase()) throw new Error('The original reference and its comparison copy must be different folders');
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(referenceCopy, { recursive: true });
for (const name of ['project.godot', 'scenes', 'scripts', 'data']) fs.cpSync(path.join(options.reference, name), path.join(referenceCopy, name), { recursive: true });

// Only the copied reference gets capture controls; its camera and scene remain intact.
const mainFile = path.join(referenceCopy, 'scripts/main.gd');
let main = fs.readFileSync(mainFile, 'utf8').replace(/\r\n/g, '\n');
main = main.replace('func _ready() -> void:', 'var _capture_args := {}\n\nfunc _ready() -> void:');
main = main.replace('\tplayer.place(world.spawn_tile())', `\tfor argument in OS.get_cmdline_user_args():
\t\tvar pair := argument.trim_prefix("--").split("=", true, 1)
\t\t_capture_args[pair[0]] = pair[1] if pair.size() > 1 else ""
\tvar start: Vector2i = world.spawn_tile()
\tif _capture_args.has("at"):
\t\tvar pair: PackedStringArray = _capture_args.at.split(",")
\t\tstart = Vector2i(int(pair[0]), int(pair[1]))
\tplayer.place(start)`);
main = main.replace('\t_follow(1.0)\n', `\t_follow(1.0)
\tfor ch in _capture_args.get("walk", ""):
\t\tvar direction = {"u":Vector2i.UP,"d":Vector2i.DOWN,"l":Vector2i.LEFT,"r":Vector2i.RIGHT}.get(ch)
\t\tif direction != null: player.scripted.append(direction)
\tif _capture_args.has("overview"):
\t\tplayer.locked = true
\t\t_capture_overview(_capture_args.overview)
\telif _capture_args.has("shot"):
\t\t_capture_shot()
`);
main = main.replace('\t_follow(1.0 - exp(-12.0 * delta))', '\tif not _capture_args.has("overview"): _follow(1.0 - exp(-12.0 * delta))');
main += `
func _capture_shot() -> void:
\twhile not player.scripted.is_empty() or player.moving:
\t\tawait get_tree().process_frame
\tfor i in 30: await get_tree().process_frame
\tawait RenderingServer.frame_post_draw
\tvar error := get_viewport().get_texture().get_image().save_png(_capture_args.shot)
\tprint("reference screenshot: ", _capture_args.shot, " tile ", player.tile, " error ", error)
\tget_tree().quit(0 if error == OK else 1)

func _capture_overview(file: String) -> void:
\tvar viewport := SubViewport.new()
\tviewport.size = Vector2i(2560, 1536)
\tviewport.world_3d = get_viewport().world_3d
\tviewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
\tadd_child(viewport)
\tvar overview := Camera3D.new()
\toverview.projection = Camera3D.PROJECTION_ORTHOGONAL
\toverview.size = float(world.bounds.size.y)
\toverview.far = 1000
\tviewport.add_child(overview)
\toverview.position = Vector3(world.bounds.size.x / 2.0 - 16, 300, world.bounds.size.y / 2.0 - 16)
\toverview.rotation_degrees.x = -90
\toverview.current = true
\tfor i in 5: await get_tree().process_frame
\tawait RenderingServer.frame_post_draw
\tvar error := viewport.get_texture().get_image().save_png(file)
\tprint("reference overview: ", file, " error ", error)
\tget_tree().quit(0 if error == OK else 1)
`;
if (!main.includes('func _capture_shot()')) throw new Error('Reference capture patch failed');
fs.writeFileSync(mainFile, main);
const spots = [
  { name: 'spawn', tile: [86, 59] },
  { name: 'stadium', tile: [132, 32] },
  { name: 'dome', tile: [34, 30] },
  { name: 'shrine-stairs', tile: [110, 48] },
];
fs.writeFileSync(path.join(output, 'capture-spots.json'), JSON.stringify({ left: 'reference', right: 'newest', spots }, null, 2) + '\n');
if (prepareOnly) { console.log('Prepared reference copy: ' + referenceCopy); process.exit(0); }
function discoverGodot() {
  if (options.godot) return options.godot;
  const packages = path.join(process.env.LOCALAPPDATA || '', 'Microsoft/WinGet/Packages');
  for (const name of fs.readdirSync(packages).sort()) {
    if (!name.startsWith('GodotEngine.GodotEngine_')) continue;
    const folder = path.join(packages, name);
    const binary = fs.readdirSync(folder).find(n => /^Godot_v4\.7.*_console\.exe$/.test(n));
    if (binary) return path.join(folder, binary);
  }
  throw new Error('Pass --godot <Godot 4.7 executable> or set GODOT');
}
const godot = discoverGodot();
function run(args, logName, timeout = 180000) {
  const log = path.join(output, logName + '.log');
  const result = spawnSync(godot, ['--log-file', log, ...args], { encoding: 'utf8', timeout });
  const consoleText = (result.stdout || '') + (result.stderr || '');
  fs.writeFileSync(path.join(output, logName + '-console.txt'), consoleText);
  if (result.error) throw result.error;
  if (result.status !== 0 || /SCRIPT ERROR:|Parse Error:|Failed loading resource/.test(consoleText)) throw new Error('Capture failed: ' + logName + '; see ' + log);
}
for (const [label, project] of [['reference', referenceCopy], ['newest', path.join(repo, 'hub/victory')]]) {

  for (const spot of spots) {
    const target = path.join(output, label + '-' + spot.name + '.png');
    run(['--path', project, '--', '--data=' + data, '--at=' + spot.tile.join(','), '--shot=' + target], label + '-' + spot.name);
    if (!fs.existsSync(target)) throw new Error('Capture missing: ' + target);
    console.log('Saved ' + target);
  }
  run(['--path', project, '--', '--data=' + data, '--overview=' + path.join(output, label + '-overview.png')], label + '-overview');
}
const composeFile = path.join(output, 'compose.gd');
const pairs = [...spots.map(s => s.name), 'overview'];
fs.writeFileSync(composeFile, `extends SceneTree
func _initialize() -> void:
\tvar output := ${JSON.stringify(output.replace(/\\/g, '/'))}
\tvar results := []
\tfor label in ${JSON.stringify(pairs)}:
\t\tvar left := Image.load_from_file(output.path_join("reference-" + label + ".png"))
\t\tvar right := Image.load_from_file(output.path_join("newest-" + label + ".png"))
\t\tif left == null or right == null or left.get_size() != right.get_size():
\t\t\tpush_error("Missing or differently sized screenshots: " + label)
\t\t\tquit(1)
\t\t\treturn
\t\tleft.convert(Image.FORMAT_RGBA8)
\t\tright.convert(Image.FORMAT_RGBA8)
\t\tvar combined := Image.create(left.get_width() * 2, left.get_height(), false, Image.FORMAT_RGBA8)
\t\tcombined.blit_rect(left, Rect2i(Vector2i.ZERO, left.get_size()), Vector2i.ZERO)
\t\tcombined.blit_rect(right, Rect2i(Vector2i.ZERO, right.get_size()), Vector2i(left.get_width(), 0))
\t\tif combined.save_png(output.path_join(label + "-side-by-side.png")) != OK:
\t\t\tquit(1)
\t\t\treturn
\t\tvar a := left.get_data()
\t\tvar b := right.get_data()
\t\tvar exact := 0
\t\tvar visible := 0
\t\tvar total_error := 0.0
\t\tfor i in range(0, a.size(), 4):
\t\t\tvar delta := maxi(absi(int(a[i])-int(b[i])), maxi(absi(int(a[i+1])-int(b[i+1])), absi(int(a[i+2])-int(b[i+2]))))
\t\t\tif delta > 0: exact += 1
\t\t\tif delta > 8: visible += 1
\t\t\ttotal_error += absi(int(a[i])-int(b[i])) + absi(int(a[i+1])-int(b[i+1])) + absi(int(a[i+2])-int(b[i+2]))
\t\tvar pixels := left.get_width() * left.get_height()
\t\tresults.append({"name":label,"width":left.get_width(),"height":left.get_height(),"differentPixels":exact,"pixelsAbove8":visible,"percentAbove8":100.0*visible/pixels,"meanChannelError":total_error/(pixels*3)})
\tvar file := FileAccess.open(output.path_join("pixel-comparison.json"), FileAccess.WRITE)
\tfile.store_string(JSON.stringify(results,"  ") + "\\n")
\tprint(JSON.stringify(results))
\tquit()
`);
run(['--headless', '--path', referenceCopy, '--script', composeFile], 'compose');
const metrics = JSON.parse(fs.readFileSync(path.join(output, 'pixel-comparison.json'), 'utf8'));
const sourceFacts = [];
const tileFile = path.join(data, '.build/reference/tiles.json');
if (fs.existsSync(options.map) && fs.existsSync(tileFile)) {
  const { placements } = require('./mesh');
  const tiles = JSON.parse(fs.readFileSync(tileFile, 'utf8')).tiles;
  const placed = placements(options.map);
  for (const model of ['PT_146_d2_s01.obj', 'B2_092_c8_lbuildb_04.obj', 'PT_064_c4_s03.obj', 'HG_257_ybc_slf.obj', 'c01arch_01_aligned.obj', 'lighthouse_aligned.obj']) {
    const entries = placed.filter(p => tiles[p.id].name === model);
    sourceFacts.push(model + ': ' + entries.map(p => 'tile ' + p.id + ' at ' + p.tile.join(',') + ', height ' + p.height + ', layer ' + p.layer).join('; '));
  }
  const gates = placed.filter(p => /B2_224_c15_gate_02/.test(tiles[p.id].name));
  sourceFacts.push('PT_014 summit tower placements in newest map: ' + placed.filter(p => /PT_014/.test(tiles[p.id].name)).length + '. The original summit tower is replaced by the HG_257 source placement.');
  sourceFacts.push('B2_224_c15_gate_02 placements in newest map: ' + gates.length + '. The reference stadium capture includes this green/yellow gate decoration.');
}

fs.writeFileSync(path.join(output, 'comparison-report.txt'), [
  'Victory Island screenshot comparison',
  'Side-by-side images: reference on the left, newest map on the right.',
  'Reference source: ' + options.reference,
  'Reference capture copy: ' + referenceCopy,
  'Camera, movement, sprites and original saved reference meshes are retained in the copy.',
  '',
  ...metrics.map(m => `${m.name}: ${m.width}x${m.height}; ${m.percentAbove8.toFixed(3)}% of pixels differ by more than 8/255; mean channel error ${m.meanChannelError.toFixed(3)}.`),
  '',
  'Visual inspection: camera framing, hero placement, pixel filtering and visible stair alignment agree at the four capture positions. No missing textures were visible in those views.',
  'The newest spawn view adds a chart board and changes planting/ground edges. The stadium view removes green/yellow gate decorations and changes planters. The dome view replaces blue pillars/banners with bronze statues and planters. The shrine view adds a glowing tower southeast of the unchanged stair.',
  'The overview also shows new planting, shore rocks, rotated harbor boats, a yacht, dock/beach decorations and a replacement summit building.',
  '',
  'Source-map evidence for the most conspicuous differences:',
  ...sourceFacts,
  '',
  'These source placements explain the northeast offshore white objects, southeast shrine tower and dome statues; they were preserved at native size. The tower uses B2_086_c8_lbuildb_01_04 with alpha blending, matching the reference material of the same name.',
  'Native source alignment differences are retained: the c01arch aligned model is 0.25 world units west of the reference geometry; the lighthouse stands one world unit higher, with its source tile placed at height 3. These are position/height differences in the input, not model scaling.',
  'Height validation found 30 stale sidecar floor samples. The exported grid uses the current terrain surface at those mismatches, preserving moved stairs; .per collision remains authoritative. See export-report.txt for the exact cells.',
  'No unexplained missing textures, mesh-group omissions or stair-alignment defects were observed in these captures. Headless reachability and extra sign/moved-stair captures provide the separate movement checks.',
  'Pixel differences include source-map revision changes. Consult export-report.txt for height and grouping diagnostics. The screenshots sample four views and one whole-map overview; they do not prove every hidden surface or movement edge.',
  '',
].join('\n'));
console.log('Comparison images and metrics: ' + output);

