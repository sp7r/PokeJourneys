# Victory Island (Godot hub)

The hub island in Godot 4.7: HeartGold-style tile movement (walk, hold to run), field camera, overworld sprites, NPC
text, signs, closed doors and area banners. Credits: [../CREDITS.md](../CREDITS.md).

No game data is in this folder. Terrain, collision, ROM models and sprites are built into a data folder outside the
repository (and outside the APK); only the layout `data/victory_island.json` (model names and tile positions) is here.

## Build the data

From the repository root in Git Bash (JDK 17 and Pokemon DS Map Studio 2.2's jars, see `tools/hub/dsms/dsms.sh`):

```sh
W=C:/Projects/hub-work/dsms; M=$W/victory-island-1to1
# 1. island design -> map layout + Godot layout (overwrites hub/godot/data/victory_island.json)
node tools/hub/dsms/victory-design-1to1.js $W/victory-design-1to1.json hub/godot/data/victory_island.json
# 2. layout -> DS Map Studio map ($M/VictoryIsland.pdsmap + .per); skip after hand edits in DS Map Studio
mkdir -p $M; [ -f $M/JourneysHub.pdsts ] || cp $W/hub-tileset/*.png $W/hub-tileset/JourneysHub.pdsts $M/
node tools/hub/dsms/victory-map.js $W/victory-design-1to1.json $M $W/tile-sig.json $W/tile-z.json
# 3. map + layout -> data folder (C:/Projects/hub-work/godot-hub)
node hub/godot/pipeline/build-data.js
```

To edit the layout in Minecraft Bedrock instead, build it there and read it back with the existing importer:

```sh
node tools/hub/dsms/minecraft-structure.js $W/victory-design-1to1.json C:/Projects/hub-work/minecraft/victory_island_bp
# zip the folder's contents as VictoryIsland.mcpack; in Minecraft add it to a world (cheats on), stand where the
# island's centre should go and run /function victory_island/prepare, then /function victory_island/build
# afterwards (on a copy of the world's db folder; x0 z0 = the "NW corner" sign, x1 z1 = x0+127 z0+127):
node tools/hub/dsms/minecraft-layout.js <db copy> <x0> <z0> <x1> <z1> $W/victory-mc-1to1.json
```

Minecraft blocks: ground block at y 108 (sea, sand beach), 109 (town), 111 (Battle Dome island), 113 (stadium
island); grass, smooth stone (paving), bricks, light blue concrete (fountain plaza); netherrack rings are building
lots at their 1:1 footprint, named by the sign next to them; oak planks are decks and bridges, oak stairs climb a
level, quartz on the water is a ship.

To show the buildings in DS Map Studio as well, after step 2 run
`node tools/hub/dsms/building-tiles.js $M hub/godot/data/victory_island.json`: it converts every building and landmark
to a 1:1 model tile, adds them to the map's tileset once and places them (backups `*.before-buildings`).
`build-data.js` leaves the map's model tiles (listed in its `model-tile-index.txt`) out of the terrain.

`build-data.js` options: `--data <dir>` (default `C:/Projects/hub-work/godot-hub`), `--map <dir>` (default
`$M`), `--layout <file>`, `--sprites <Godot overworld project>/game` (overworld sheets). It writes
`victory_island/terrain/island.obj` (+ textures), `cells.json` (top tile and height per cell), `collision.json`
(walk, block, water, bridge, stairs from the `.per` files), `models/<name>/` (GLB + PNGs) and `sprites/`.

The map is 128 x 128 tiles (4 x 4 maps): town island with the promenade, boardwalk, pier and beach in the south,
Battle Dome island (level 2) north-west, stadium island (level 3) north-east. Buildings are the ROM models at native
size (16 DS units per tile) on lots sized to them, doors facing south.

## Run

```powershell
$godot = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\GodotEngine.GodotEngine_Microsoft.Winget.Source_8wekyb3d8bbwe\Godot_v4.7.2-stable_win64.exe"
& $godot --path hub/godot -- --data=C:/Projects/hub-work/godot-hub
```

The data folder is found from `--data=<dir>`, then `JOURNEYS_HUB_DATA`, then `user://hub-data` (on Android the
app's internal files folder). Arrows/WASD or the d-pad move, Shift or gamepad B runs, Z/Enter/Space or gamepad A
talks and reads, Escape quits on desktop.

A model blocks the tiles where it has surfaces at body height (0.2 to 1.6 tiles above its base): walls, posts and
counters block; floors, shadows, roofs and arches don't. A layout entry may set `"block": [x0, y0, x1, y1]` instead,
or `"block": false`. Shipmaster NPCs call `_on_shipmaster()` in `main.gd`, where the journey picker will go.

## Test flags (after `--`)

- `--data=<dir>`: data folder.
- `--at=x,y`: start tile. `--walk=uuddlr`: queued moves. `--speed=<n>`: time scale. `--talk`: interact after the walk.
- `--shot=<file.png>`: screenshot after the walk (and text box), then quit.
- `--check`: walk every reachable tile from the start with the player's rules; prints JSON with every door, NPC and
  sign and whether it can be reached; exit code 0 only when all can. Works with `--headless`.
- `--grid`: print the walk grid (`.` walk, `#` block, `~` water, `=` bridge, `S` stairs, `D` door) after the models
  are placed; combine with `--check --headless`.
- `--overview=<file.png>`: top-down picture of the whole map; add `--overlay` for red markers on blocked tiles.

```powershell
& $godot --path hub/godot --headless -- --data=C:/Projects/hub-work/godot-hub --check
& $godot --path hub/godot -- --data=C:/Projects/hub-work/godot-hub --at=111,117 --walk=d --talk --shot=C:/Temp/pier.png
```
