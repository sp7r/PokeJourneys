# DS map rendering experiment

Standalone desktop tools. The Android build is untouched. Code and documentation live here and in `tools/hub/`; all extracted models, textures, converted files, images and logs must stay under `C:\Projects\hub-work\`.

## Convert

Use an existing apicula extraction of your own ROM. Set `$extract` to that directory and `$apicula` to the executable. From the repository root in PowerShell:

```powershell
./tools/hub/convert-models.ps1 -Extract $extract -Pattern 'm_stadium*' -Out C:\Projects\hub-work\stadium-final -Apicula $apicula
./tools/hub/convert-models.ps1 -Extract $extract -Pattern 'map??_??' -Out C:\Projects\hub-work\maps-final -Apicula $apicula
./tools/hub/convert-models.ps1 -Extract $extract -Pattern 'map_out*' -Out C:\Projects\hub-work\map-out-glb -Apicula $apicula
foreach ($pattern in @('c5_wbt*', 'm_Wbt*', 'wbtgate*', 'wbt_fountain', 'c5_fvessel*')) {
    ./tools/hub/convert-models.ps1 -Extract $extract -Pattern $pattern -Out C:\Projects\hub-work\pwt-glb -Apicula $apicula
}
```

Texture selection uses the **texture and palette references printed by `apicula info`**, not the model filename. The script searches the extracted NSBTX files' ASCII name records for those names, including full 16-byte names with no terminator. It greedily selects the file covering the most remaining references; ties follow sorted filenames. Quoted names are unquoted. It passes the model and selected texture sets together to `apicula convert -f glb`. A manifest records the selected files and unresolved names; each model has its own conversion log.

This is name matching, not ROM map-header/season resolution. Duplicate names in different sets can be ambiguous. The supplied extraction resolved every numbered chunk and both stadium models; the images were checked visually. Seasonal variants and arbitrary other ROMs need their own checks. Embedded textures in an NSBMD can also satisfy references independently of the manifest's NSBTX search.

Each source model has its own output subdirectory, preventing PNG name collisions. Apicula's GLB output references PNG sidecars; keep the entire model directory together. The renderer embeds those PNGs into copies under its output's `packed/` folder before loading them.

## Build and render

Requires JDK 17 and a working desktop OpenGL driver. Every Gradle invocation must use the dedicated Gradle home. From the repository root in PowerShell:

```powershell
$env:JAVA_HOME='C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot'
$env:GRADLE_USER_HOME='C:\Projects\hub-work\gradle-home'
sh ./gradlew -p hub/render build installDist
sh ./gradlew -p hub/render run '--args=C:/Projects/hub-work/stadium-final C:/Projects/hub-work/stadium-renders 768'
sh ./gradlew -p hub/render run '--args=C:/Projects/hub-work/maps-final C:/Projects/hub-work/map-renders 512'
sh ./gradlew -p hub/render run '--args=C:/Projects/hub-work/pwt-glb C:/Projects/hub-work/pwt-renders 768'
sh ./gradlew -p hub/render run '--args=C:/Projects/hub-work/map-out-glb C:/Projects/hub-work/map-out-renders 512'
```

After `installDist`, the same program can run without Gradle:

```powershell
./hub/render/build/install/hub-render/bin/hub-render.bat C:/Projects/hub-work/pwt-glb C:/Projects/hub-work/pwt-renders 768
```

Arguments are input directory, output directory, and optional square image size (default 512). Input is searched recursively. The process creates a hidden 64x64 LWJGL3 window and an offscreen framebuffer, renders everything, then exits. It needs a display session and OpenGL context; this is not a software-only renderer. Audio is disabled. Failures are logged and cause a nonzero exit status.

Outputs:

* `<model>-top.png`: orthographic view from +Y, north (-Z) at the top, fitted to the full model bounds.
* `<model>-field.png`: perspective, 35-degree vertical field of view, looking down 45 degrees from +Z. Fits the bounding box with a small margin.
* `contact-top.png` and `contact-field.png`: labeled contact sheets.
* Numbered chunks also get `<model>-tile.png`: orthographic view of their fixed 512x512 ground footprint, centered at X=Z=0. Geometry extending beyond a chunk boundary is clipped here, while the standalone top/field views retain it.
* `world-grid.png`: numbered tile views arranged with XX as column and YY as row, 256 image pixels per chunk. North is up. Missing chunks are black. The tested grid is 6912x6144 pixels.
* `packed/*.glb`: self-contained render inputs, with apicula's external PNGs embedded and padded byte RGB colors normalized to RGBA. The RGB adjustment avoids a loader stride issue; original files remain intact.

Materials retain the converter's texture sampling, vertex colors, alpha mode and double-sided flags through gdx-gltf's shader. Culling is not globally disabled. This preserves the converted DS face settings, including reversed faces already handled by the converter. There is no added scene lighting on the exported unlit materials.

Optional crops from the assembled grid:

```powershell
./tools/hub/crop-map.ps1 -Image C:\Projects\hub-work\map-renders\world-grid.png -Out C:\Projects\hub-work\pwt-plaza.png
./tools/hub/crop-map.ps1 -Image C:\Projects\hub-work\map-renders\world-grid.png -Out C:\Projects\hub-work\driftveil-area.png -Column 4 -Row 11 -Columns 4 -Rows 5
```

## Black 2 findings

The PWT exterior is **`c5_wbt_01.nsbmd`**. Its circular blue roof, entrance display, scaffolding, and red/blue banners identify it directly in the render. The model's texture set in this extraction is recorded in its manifest. The PWT is south of Driftveil City, consistent with the [location overview](https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9mon_World_Tournament).

| File | Role |
| --- | --- |
| `map05_14` | Western PWT plaza, building placement area, stalls, approach from Driftveil, and Relic Passage entrance to the west |
| `map06_14` | Eastern PWT plaza, circular fountain placement area, stalls, and entrance to southern pier |
| `map05_15`, `map06_15` | Water and the southern wooden piers |
| `map05_13`, `map06_13` | Immediately north: southern Driftveil and bridge toward the east |
| `c5_wbt_01` | Separate PWT exterior building, visually placed in the northern part of `map05_14` |
| `wbt_fountain` | Separate exterior fountain, associated with the circular area in `map06_14` |
| `wbtgate_01`, `wbtgate_01.001` | PWT covered approach/gate variants; same internal model name, distinct source filenames preserved in image labels |
| `m_Wbt01_00_00` | PWT reception lobby, with blue carpet and green counters |
| `m_Wbt02_00_00`, `m_Wbt02_01_00` | Two parts of the PWT competition arena and spectator stands |
| `c5_fvessel_01`, `c5_fvessel_01.001` | Driftveil vessel variants, rendered as nearby scenery candidates; exact dock placement not decoded |
| `m_stadium01_00_0` | Nimbasa Big Stadium entrance lobby, blue fixtures and green floor trim |
| `m_stadium02_00_0` | Nimbasa Small Court entrance lobby, red fixtures and purple floor trim |

The two sports lobby models are distinct from the PWT. Their identity is consistent with Nimbasa's [Big Stadium and Small Court](https://bulbapedia.bulbagarden.net/wiki/Big_Stadium_and_Small_Court); the file-to-lobby mapping is based on the rendered models' appearance, not decoded warp records.

There are **189 numbered `mapXX_YY` models**, plus six reusable `map_out*` edge models in this extraction (195 total `map*`). The edge models have no grid coordinates and are rendered separately. The chunk filename coordinates form a coherent map without transposition.

## Validation and limits

Built with the repository's Gradle 8.10.2 wrapper and JDK 17. Hidden-window rendering succeeded for both stadium lobbies, all 189 numbered chunks, all six edge models, and nine PWT/scenery candidates. Checked the stadium contact sheet, individual PWT building and interior views, the assembled map, and Driftveil/PWT crops. The final numbered-chunk and stadium manifests have zero unresolved texture/palette references.

* Apicula reports `material: texture matrix is unimplemented` 45 times across the numbered chunks, and three times on `c5_wbt_01`. Those materials' texture transforms/effects may differ from the game. Static texture presence does not prove exact in-game appearance.
* Apicula's `FB_ngon_encoding` metadata is unsupported by gdx-gltf. The exported triangle geometry renders successfully; original polygon grouping is not used.
* Animations, dynamic screens, water effects, day/night lighting, NPCs and sprites are not reconstructed. The current images are static model previews.
* The full grid shows map-chunk geometry. Separately placed buildings and props are absent from it. Their models are rendered separately; ROM placement tables, transforms, warps and exact object IDs have not been decoded. Building/fountain chunk assignments above come from the visible plaza layout, not a placement-table proof.
* Texture selection does not choose a season explicitly. `map_outdesert` has 12 unresolved NSBTX search references; its conversion/render completed, but that edge model is not considered fully texture-verified.
* This verifies the asset/render path on desktop, not an Android runtime integration or an exact DS rasterizer. DS polygon ordering, blending and hardware effects may differ.

See [CREDITS.md](CREDITS.md) for the desktop dependencies. No game data or derived images are included in this directory.

## Playable desktop hub (H2)

`game/` is a separate libGDX application with `core`, LWJGL3 `desktop` and `android` modules. It builds a tiled plaza and harbor at runtime and loads the stadium, Battle Dome, shops, decorations and ferries from your converted ROM data. No game assets are copied into its build, its APK or its distribution. The main Android app is unchanged.

From the repository root in PowerShell:

```powershell
$env:JAVA_HOME='C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot'
$env:GRADLE_USER_HOME='C:\Projects\hub-work\gradle-home'
sh ./gradlew -p hub/game build :desktop:installDist
sh ./gradlew -p hub/game :desktop:run '--args=--data C:/Projects/hub-work'
```

`--data` is required. It names the external directory containing `maps-final/`, `pwt-glb/`, `buildings-glb/` and `decor-glb/`, with each model and its PNG sidecars in its own subdirectory as produced above. File names are configured in `game/config/world.json`; change the relative paths there if your conversion directories differ. All resolved model paths must remain inside the supplied data directory, under `C:\Projects\hub-work`. Missing files produce a console message and an error screen. Running without `--data` prints usage and exits with status 2.

Playing works like a HeartGold overworld (movement and camera follow the Godot prototype in `C:/Projects/Godot pokemon`): the player walks tile by tile, 0.25 s a tile, 0.13 s running; a quick tap turns on the spot; a step may rise or drop at most 12 units between tile centres, so stairs pass and cliffs and deck edges do not. The camera is HeartGold's field camera type 0 (41.7 tiles away, 48.7 degrees down, 16.2-degree vertical field of view), locked on the player. Buildings carry no floating names: a signpost by each door holds the name, and A on the tile in front shows it in a text box (townspeople show their `text`, or their name). Entering a zone shows its name in a banner. Controls: WASD or arrows to walk, Shift or X (gamepad B) to run, Z, Enter or Space (gamepad A) to read or talk, Escape to exit. On Android without a gamepad an on-screen D-pad and A / B buttons appear; Back closes a text box, then exits. Review and tour runs keep the older free movement and overhead camera, and show the zone labels.

`--play-shot DIRECTIONS` (desktop) plays a short script for checking the play view: one character every 20 frames, `0` down, `1` left, `2` right, `3` up, `a` to read, then saves `C:/Projects/hub-work/hub-shots/play.png` and exits.

The default trainer layers an eyeless body, eyes, bottoms, top, footwear and hair at startup. `game/config/character.json` chooses the outfit, overlay tints, sheet size in world units and frame timings (160 ms walking, 100 ms running). Sheets use four direction rows and four animation columns, with nearest-neighbor filtering. The 32-unit sheet includes transparent margins; the visible body is approximately one 16-unit map tile wide. Character sheets remain in the existing credited `assets/creator/` directory and are read directly. No sprite atlas containing game data is generated.

`--config DIRECTORY` overrides the directory containing both JSON files; `--art DIRECTORY` overrides the creator art directory. Defaults are relative to `hub/game`, where Gradle's run task starts. To use the installed launcher without Gradle:

```powershell
Push-Location hub/game
./desktop/build/install/desktop/bin/desktop.bat --data C:/Projects/hub-work
Pop-Location
```

### Android build

With the Android SDK found (`ANDROID_HOME`, or `sdk.dir` in an untracked `hub/game/local.properties`), the build includes the `android` module (package `journeys.hub.game`, app name Victory Island, minimum Android 8.0, landscape):

```powershell
sh ./gradlew -p hub/game :android:assembleDebug
```

The APK is `hub/game/android/build/outputs/apk/debug/android-debug.apk`. It holds no game data: the hub reads it from the app's private storage, `files/data` (with `config/` and `art/` inside), and says where the data should be until it is there. `node tools/hub/android-data.js` gathers exactly what the hub reads (config, the character sheets, the exported island with its collision files and textures, ground textures and the ferry models, about 21 MB) into `C:/Projects/hub-work/android-data`; with `--push` it also copies it to a phone connected over adb (through `/data/local/tmp` and `run-as`, so a debug build is needed). Install the APK first (`adb install -r hub/game/android/build/outputs/apk/debug/android-debug.apk`) so the app's folder exists. This hand copy stands in for the planned first-run import, which will build the same folder from the player's own ROMs.

### Review mode

```powershell
$env:JAVA_HOME='C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot'
$env:GRADLE_USER_HOME='C:\Projects\hub-work\gradle-home'
sh ./gradlew -p hub/game :desktop:run '--args=--data C:/Projects/hub-work --review'
```

Review mode ignores movement input, advances at a fixed simulation step, walks and runs through the same collision/movement code used by live play, captures 1100x760 screenshots at the configured waypoints, then exits. Outputs are always external under `C:\Projects\hub-work\hub-shots\`: the configured review screenshots and `review.txt` with positions, movement state, zone and collision results. Reruns overwrite those files. Packed GLB cache files go only to `C:\Projects\hub-work\hub-cache\`. OpenGL and a desktop display session are required. Review failures return a nonzero exit code; a blocked route times out after 35 simulated seconds.

Tour mode (`--tour` in place of `--review`) captures a layout overview: one high overhead shot of the whole hub with every zone label, then one shot standing in each zone from `world.json`. The player is teleported to the walkable point nearest each zone centre instead of walking. Outputs go to `C:\Projects\hub-work\hub-shots\tour\` (`00-overview.png`, one numbered PNG per zone, and `tour.txt` with positions).

### Placement, collision and limits

`world.json` holds ground polygons/rectangles and texture paths, model placements, blockers, NPCs, zones and review waypoints. `worldScale` remains 1.5: sprite dimensions, movement speeds, player/NPC radii and follow-camera distance are divided by it. Ground and model coordinates stay unchanged. Model transforms apply translation, Y rotation, then uniform scale. +X is east; +Z is south, toward the fixed camera. All building entrances face south with `rotY: 0`.

### Generated ground and layout

The floor is one generated model, using repeating nearest-filtered textures loaded only at runtime from the external data directory. `ground.textures` names every texture by a short key and gives its path under `maps-final/` (any of the converted Black 2 map chunks; contact sheets of all 471 textures are in `C:/Projects/hub-work/texture-sheets/`). One 32-pixel texture repeats every 32 world units (`tile` scales that per shape). Nothing is copied into the source tree or build.

`ground.rectangles` entries are polygons (`"points":[[x,z],...]`) or rectangles (`x, z, w, d`). Kinds:

| Kind | Purpose |
| --- | --- |
| `plaza`, `garden`, `pier` | Walkable land. The coastline of their union gets a sea wall (`wall`, default `wall` / `pierWall`) and a railing (`rail`, or `"railing": false` for beaches and lawns). Later land shapes sit slightly higher, so overlaps never flicker. |
| `avenue` | Walkable inlay; can also extend walkable ground on its own. |
| `deco` | Flat overlay (district paving, curbs, paths, flower meadows) stacked by `layer`; no effect on walking. |
| `box` | Raised block with `height`, top `texture` and `side` texture, or `sides` with one texture per edge, and optional `base` height (hedges, planters, ponds, stadium stands, floodlight towers); blocks walking. |
| `shallows` | Lighter water just above the sea (the turquoise ring around the island); not walkable. |

Every shape may set `texture` to any key in `ground.textures` (default: its kind). `ground.rings` draws upright rims with spokes (`x, y, z, radius, thickness, spokes, texture`), used for the Ferris wheel whose rim did not survive conversion. Water extends 10,000 units beyond the land.

`sprites` are billboard scenery drawn from ground textures, the way DS overworlds draw trees: `{"texture":"tree","x","z","h","block"}` (width follows the texture's aspect; `block` is a collision radius). Walkability is point-in-polygon on land and avenues, minus boxes, footprint `blockers`, sprite and NPC radii. `checks.blocked` lists points (water, building interiors, ships) that review mode asserts are never walkable. A zone's optional `view` raises the tour camera for tall landmarks.

The hub is a compact island (about x 0..1200, z 0..970, plus the western pier), grass with a sandy rim and wide west beach. Victory Island, described below, replaces it when `ground.tiles` is set; the polygons remain as the fallback ground. Buildings and props sit at their native size next to the player; only the Battle Dome, the central fountain and the ferries are enlarged. Every door faces south (+Z) toward the fixed camera.

| Area | What is there | Models / textures |
| --- | --- | --- |
| Stadium (north) | Open-air stadium for PvP and tournaments, built from generated tiers: crowd sheets on the steps, blue barriers facing the field, truss outside, four floodlight towers, the tournament-bracket jumbotron, the PWT emblem on the court, tunnel entrance in the south | `pwt-glb/m_Wbt02_00_00` textures (`in79_fan1-3`, `in79saku01`, `in79tou01`, `in79light02`, `in79_e`), `m_Wbt01_00_00/in71_tvm1` |
| Central Fountain | Cobbled plaza with the PWT fountain, lamp ring, planters, Pikachu statue; spawn | `wbt_fountain`, `c04_poke01` |
| Battle quarter (north-east) | Battle Dome (bot battles), Battle Hall, Leaderboards | `c04tcourt_01`, `houses-glb/c5_rbuild_01`, `sign01`/`sign02` |
| Garden (east) | Hedge parterre with vine-arch entrance, statue, jets fountain, pond fountain, flower beds | `c01arch_01`, `c5_statue_01`, `c15_fountain_01`, `c01fountain_01`, `c04_plant_01` |
| Beach (west) | Ferris wheel, Game Corner, beach shack, snack truck, parasols; boardwalk to the harbor pier | `c04_fwheel_01`, `c1_rest_01`, `houses-glb/c14_house_01`, `houses-glb/c15_trailer_01` |
| Harbor (west pier) | Region Ferry and Event Ferry with portmasters | `c13_ship_01`, `c03_ship_02` |
| Market Row (south) | Poke Mart, Cafe, Move Tutor, Flower Shop, Bike Shop | `pc_01`, `c2_cafe_01`, `houses-glb/c12_house_01`, `rr_hanaya_01`, `houses-glb/c13_house_02` |
| Harbour Row (south) | Auction House, Boutique, Trophy Hall, Vault, Wardrobe | `c5_market_01`, `houses-glb/c6_house_01`, `houses-glb/c5_church_01`, `c2_museum_01`, `c04theater_01` |
| South-east point | Lighthouse | `houses-glb/c5_lhouse_01` |

Townspeople are `npcs` entries with an optional `wander` radius: they stroll to random walkable spots near home, animate their walk, keep clear of the player and each other, and block the player like portmasters. Review, tour and the editor keep them at home so runs repeat.

Building models come from `buildings-glb/`, `houses-glb/`, `pwt-glb/`, `decor-glb/` and `props-glb/` under the data directory (converted with `tools/hub/convert-models.ps1` from the Black 2 extraction in `C:/Projects/hub-work/b2-extract`). The layout itself lives entirely in `world.json`; edit it with the layout editor below.

NPC entries contain `name`, `x`, `z`, `facing` (0 down, 1 left, 2 right, 3 up), and one RGBA tint per character layer. They reuse `character.json` sheets. Overlapping zones select the nearest centre.

Review checks every listed blocked point, footprint and NPC, then runs flat out in all four directions from spawn and confirms the player stays on walkable ground; its route circles the fountain plaza, enters the stadium, then follows the boardwalk out along the pier. Tour fits the overview to the land bounds, then captures each zone. Old numbered tour PNGs are replaced on each run. The editor self-test finds Battle Dome by filename and exercises model movement/rotation, polygon movement, vertex insertion/deletion, save/reload, undo and rectangle insertion/deletion. Outputs and packed model caches stay under `C:/Projects/hub-work`.

This is a flat-ground prototype. No jumping, building entry, interactions, networking, camera rotation, audio, water animation or Android launcher is implemented. Model conversion limitations above still apply, including static effects and unsupported polygon metadata. Physical controller buttons need hands-on verification. Building and ferry roles are placeholders.

### Victory Island in DS Map Studio

The hub island, Victory Island, is a [Pokemon DS Map Studio](https://github.com/Trifindo/Pokemon-DS-Map-Studio) 2.2 project: ground, cliffs, stairs, buildings, props and trees are all tiles, placed by hand in the editor. `world.json` keeps what the map cannot hold: the two ferries, the short wooden ramps from the boardwalk down to the beach (`pier` shapes), the daycare fence, NPCs, zones, spawn, review route and collision checks. `ground.tiles` points the hub at the map's export:

```json
"tiles": { "obj": "dsms/victory-island/export/VictoryIsland.obj", "per": "dsms/victory-island/VictoryIsland",
           "maps": [3, 3], "x": 0, "z": 0, "size": 20 }
```

The project is a 3x3 map matrix (96x96 tiles, 20 hub units per tile) with the north-west corner of map (0,0) at hub `x, z`. It lives outside the repository in `C:/Projects/hub-work/dsms/victory-island/` (`VictoryIsland.pdsmap`, the `JourneysHub.pdsts` tileset and its PNGs, `VictoryIsland_XX_YY.per`).

**Tiles.** Ground uses the Platinum Resort Island set: grass 1157, beach sand 1181, sea 1170, paving 1167, red brick 1165, sand path 1166, flowers 1171-1173, and edge/corner families for sand/sea (1054-1061, 1120-1129), sand/grass (1094-1101, 1140-1149), paving/grass (1062-1069, 1122-1131), path/grass (886-893, 1134-1143) and brick/paving (1046-1053, 1118-1127). Cliffs use the light brown HeartGold mountain rock: sides 454-457, outer corners 458-461, inner corners 686-689; each piece is one level high. Stairs, one level over three tiles: 1238 (up to the north), 1239 (south), 1240 (east), 1241 (west). Trees 879-882, palms 1258-1260. Plank decks (boardwalk, piers, bridges) sit on layer 2 one level up: 370 (1x3) side by side for east-west decks, 368 (3x1) for north-south ones, 369 / 358 two wide, 1245 / 1249 single boards; a bridge between two levels has a stair tile across its middle. Deck cells use the Gen 4 "bridge over water" behaviour (`0x73`) in the `.per` files, which tells the hub to stand on the deck (the highest broad surface) rather than the water below. White rails 389-395 and wooden fences 381-387 (straights, corners, cross) line edges on layer 3. Tiles 1638 onwards are the converted Black 2 / HeartGold buildings and props (the Pokeathlon Dome is `poke_c_dome2`); `victory-island/model-tile-index.txt` lists them by name and size. DS Map Studio limits tiles to 6x6, so larger buildings overhang a centred 6x6 square. Tiles 1740-1754 (`track_NWNESWSE`, one per pattern of track corners) are the HeartGold Pokeathlon track: orange with a white rim, see-through elsewhere, laid on layer 4 just above the ground so they can be painted over grass by hand; 1755 is the Pokeathlon glass archway (`poke_c_obj`), walked through. 1756 is the round Poke Ball plaza in front of the stadium (one 13-tile disc drawn from the same track texture, see-through outside the circle), and 1757-1760 are the Pokeathlon bench, flower bed, light and sign.

**Rendering and walking.** With `ground.tiles` present, the hub draws the exported mesh instead of the `plaza`, `garden`, `avenue`, `shallows` and `deco` shapes; `pier`, `box` shapes, decos marked `"overTiles": true` and `rings` are still drawn. The player, NPCs, models, sprites and camera stand on the ground height of the mesh (the lowest surface under a point, so props never count as floor). Walking uses the `.per` collision files (`0x80` blocks) plus pier decks, and no single step may rise or drop more than 6 units, so cliffs and deck edges stop the player while stairs and ramps do not. A pier may ramp: `"y"` at its low-coordinate end, `"y2"` at the other, along `"axis"` (`x` or `z`).

To edit:

1. Open `C:/Projects/hub-work/dsms/victory-island/VictoryIsland.pdsmap` in DS Map Studio (File > Open Map; loading the large tileset takes about half a minute). Pick a map in the Matrix panel. Paint ground on layer 1; put buildings, props and trees on layers 2 and up so the ground stays underneath. Tiles larger than 1x1 are placed from their south-west cell. Raise ground with the height column next to the map and the cliff and stair tiles above.
2. Paint collisions with the collision editor (Gen 4 layout: behaviour byte then collision byte; `0x80` blocks walking, `0x15` marks sea). Mark buildings, trees, cliffs and water.
3. Save (File > Save Map), then export with File > Export Map as OBJ with textures, **Export All Maps Joined**, vertex colours off, saved as `C:/Projects/hub-work/dsms/victory-island/export/VictoryIsland.obj`. Or, from the repository root in Git Bash: `sh tools/hub/dsms/dsms.sh export` (the same exporter code, no window).
4. Run the hub, `--tour` or `--review` as above.

**Starting the map from a Minecraft build.** The first version of the map was drawn in Minecraft Bedrock and converted, one block per tile. The tools in `tools/hub/dsms/` (run with Node and JDK 17 against the DS Map Studio jars in `C:/Projects/hub-work/dsms/app/`; everything they write stays under `C:/Projects/hub-work/`):

| Tool | What it does |
| --- | --- |
| `bedrock-world.js` | Reads a copy of a Bedrock world's `db` folder (LevelDB, zlib): blocks and sign text. |
| `minecraft-layout.js` | Area of the world to a layout: grass/sand/slabs/bricks/water become ground; ground height becomes level (y 108 and below sea and beach, 109-110 town, 111-112 Battle Dome island, 113 and up stadium island); netherrack = building lots (a row built touching is split halfway between the signs on it; with no stadium sign the largest unnamed lot is the stadium), quartz on water = ships, quartz on sand = towels, planks = decks and bridges (flat, at the planks' level), planks on posts with two or more blocks of headroom over dry ground = vine arches, green concrete or leaves = trees (one 2x2 tree per 2x2 square), concrete stairs = parasols, other stairs = stair flights (direction from the block's facing), stone walls and pale oak fences = white railings, other fences = wooden fences; each sign names its lot ("filler" signs get a house that can't be entered, picked by the lot's size). |
| `victory-map.js` | Layout to `.pdsmap` and `.per`: corner-lattice autotiling of ground (paths drawn about two tiles wide), cliffs (drops of several levels stack cliff pieces on the top layers; the clean-up never lifts ground above its Minecraft level, so island edges stay a single drop), stair flights carved one row per level, plank decks and bridges on layer 2 (boards laid from the south edge so it stays straight; water boxed in between the shore and a pier above the boardwalk becomes land), paving on the stadium island drawn as Pokeathlon track, railings and fences on layer 3 (blocking), `tiles.json` summary. Buildings stand on grass; paved aprons are optional (an `aprons.json` file) and `rebuild` leaves them out. |
| `glb-to-obj.js`, `model-tiles.js`, `TileImport.java` | Converted `.glb` models to OBJ tiles at their hub size, appended to the tileset with DS Map Studio's tile loader. |
| `victory-world.js` | Writes `world.json` (decks, ramps, ferries, fence, NPCs, zones, a review route found by path search) and, given the map folder, places buildings, props, the dome, the glass archway over the walkway south of the stadium and trees into the map with their collisions, then fills open grass near the town's buildings with up to 14 small houses that can't be entered (doors south, never on a path, every walkable tile stays reachable). |
| `deck-collisions.js` | Marks every cell under plank or bridge tiles (370, 368, 369, 358, 1245, 1249 and the flat bridge piece 171) as bridge over water (`0x73`) and walkable in the `.per` files, so bridges and walkways lengthened or built by hand are walked on at plank height; railing cells keep their collision. `dsms.sh export` runs it first. |
| `signs.js` | Puts a HeartGold signpost (`board_a`, tile 1761) beside the door of each named building (the model tile nearest the zone of the same name; on the boardwalk it stands at plank height) and writes them into `world.json` as `signs` (`x`, `z`, `text`), which the hub reads with A. Signs already by a door are kept; no sign may cut walkable ground off (`node tools/hub/dsms/signs.js C:/Projects/hub-work/dsms/victory-island hub/game/config/world.json`, then `dsms.sh export`). |
| `restep-cliffs.js` | For a map already edited by hand: turns stacked cliffs (drops of two or more levels) into steps, one 1-high cliff per level, each a tile further out over the water or sand at the foot, so the ground on top stays. Leaves stairs, bridge ends and unknown tiles alone; backs up the `.pdsmap` and `.per` files first (`node tools/hub/dsms/restep-cliffs.js C:/Projects/hub-work/dsms/victory-island C:/Projects/hub-work/dsms/tile-z.json`, then `dsms.sh export`). |
| `decorate.js` | For a map already edited by hand: lays the Poke Ball plaza (trimming track that pokes out past the disc, except the paths leading in) and fills bare lawns with lamps and planters along the paths, benches, Pokeathlon lights and flower beds on the stadium island, a small fountain, the Pikachu statue, tree groves and flower patches. Only flat, walkable, bare grass is used; the hub review route, NPCs, the spawn, doorsteps and the daycare pen stay clear, and no prop may cut walkable ground off. Backs up the map and `.per` files (`node tools/hub/dsms/decorate.js C:/Projects/hub-work/dsms/victory-island C:/Projects/hub-work/dsms/tile-z.json hub/game/config/world.json`, then `dsms.sh export`). |
| `PlazaTile.java` | Draws the Poke Ball plaza tile (`dsms.sh props`). |
| `TrackTiles.java` | Draws the track overlay tiles from the HeartGold `pk_track` texture (OBJ + PNG per corner pattern). |
| `dsms.sh` | `props` (once: the plaza tile and the Pokeathlon bench, flower bed, light and sign, appended to both tilesets), `pokeathlon` (once: track tiles and the glass archway appended to the map's tileset, from models converted with `convert-models.ps1` and textures exported with `apicula convert --more-textures` into `C:/Projects/hub-work/pokeathlon-glb`), `rebuild` (copy the Minecraft world, convert, map, buildings, `world.json`, export in one go), `export`, `preview` (top-down PNG), `sheets` (labelled tile sheets), `generate` (refuses to overwrite a map unless `--force`). |

Rerunning the conversion replaces hand edits in the map, so once the map is being edited in DS Map Studio, edit it there. DS Map Studio stores tile rows bottom-up inside each map while `.per` rows run north to south; the tools and the hub account for both.

### Layout editor

Launch from the repository root in Git Bash (JDK 17, normal window with vsync):

```bash
export JAVA_HOME="C:/Program Files/Microsoft/jdk-17.0.20.101-hotspot"
export GRADLE_USER_HOME="C:/Projects/hub-work/gradle-home"
sh ./gradlew -p hub/game :desktop:run --args="--data C:/Projects/hub-work --edit"
```

Use only one of `--edit`, `--review` or `--tour`. The editor hides the player and keeps the tilted camera. Press B to show layout markers; ground polygons show green outlines and vertex handles. Click a handle to select a vertex, or click inside a shape to select and drag the whole shape.

| Keys | Action |
| --- | --- |
| WASD / arrows, right mouse drag | Pan the camera |
| Mouse wheel | Change camera height / zoom |
| Left click, Tab / Shift+Tab | Pick an item, cycle models forward / backward |
| Left drag | Move the selection; a selected polygon handle moves only that vertex |
| Ctrl+arrows | Nudge 1 unit; Ctrl+Shift: 8 units |
| Q / E | Rotate a model 15 degrees; Shift: 1 degree |
| + / - (including numpad) | Change model scale by 0.05, minimum 0.1 |
| Ctrl+D | Duplicate a model, offset 20 units in x and z |
| N, Up / Down, Enter | Browse converted models and add at the camera look-at point |
| Esc in model list | Close the list |
| B | Show blocker boxes, green ground outlines, zone circles, NPC markers and tree sprites; clicking markers takes priority over models |
| [ / ] | Decrease / increase blocker/rectangle width or zone radius by 8; Shift: 1 |
| ; / ' | Decrease / increase blocker/rectangle depth by 8; Shift: 1 |
| Insert | With a polygon selected: insert the midpoint after the nearest vertex; otherwise add a 40 by 40 blocker |
| G+Insert | Add a 40 by 40 plaza ground rectangle at the look-at point |
| Delete | Remove a selected polygon vertex (minimum three); otherwise remove the selected item |
| Ctrl+S | Save world.json with numbers rounded to one decimal; previous file becomes world.json.bak |
| Ctrl+Z | Undo the last edit (one drag is one edit) |
| Esc | Quit immediately; unsaved changes are lost |

The HUD shows the selection and warns about unsaved changes. Save keeps the existing JSON fields and order, with `ground` immediately after `worldScale`. Ground geometry rebuilds after every ground edit, including undo. Collision is skipped in the editor; launch the game again to use the saved layout. Converted models and screenshots stay outside the repository.
