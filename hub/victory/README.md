# Victory Island

Godot 4.7 project for the owner's Frontier Terraces map. The project contains code, scenes and a layout only. Meshes, textures, collision data and sprites stay outside the repository.

Based on PokeDaisy by Lidor Itzhari - https://github.com/lidor30/pokedaisy

From the repository root, export the newest DS Map Studio map with Node and JDK 17 installed:

```powershell
node tools/hub/victory/export.js
```

The default output is `C:/Projects/hub-work/victory-island-data`. The exporter prints its output paths and writes `export-report.txt` there. Read that report after editing the map, especially if a doorway's building moves.

Start the project with Godot 4.7.2:

```powershell
$godot = "$env:LOCALAPPDATA/Microsoft/WinGet/Packages/GodotEngine.GodotEngine_Microsoft.Winget.Source_8wekyb3d8bbwe/Godot_v4.7.2-stable_win64.exe"
& $godot --path hub/victory -- --data=C:/Projects/hub-work/victory-island-data
```

A normal start opens on a title screen (`branding/splash.png` with `branding/logo.png` and a blinking "PRESS A TO START"), then, in the app, the Discord sign-in (`scripts/signin.gd`; only when the app has a Discord client id and nobody is signed in). With a server (always in the app, and with `--live` on a PC) the splash then stays up: "Connecting to the server...", then "Server Online · N players online" from the server's `/api/status`, until this player is in the island's room; when the server can't be reached it says so and A tries again (there is no offline play). Then, on the first start, the island flyover and the character creator, then the `welcome` pages from `data/layout.json` followed by the server's announcements (set on the admin console's Overview). The flyover (`scripts/intro.gd`) plays `intro` from `data/layout.json`: each shot has a `caption`, the `tile` it looks at, the camera's `distance`, `pitch` and `yaw` in degrees (yaw 0 looks north, as the field camera does) and its `seconds`; the camera glides from shot to shot and drifts slowly while holding one, and A skips the rest. `--intro` plays it alone and quits. The creator (`scripts/creator.gd`, `scripts/character.gd`) builds the hero from the credited parts in `assets/creator/sprites` (body and skin, hair, top, bottom, bag, hat, each with its colours; parts marked ` f`/` w` or ` m` only show for that body), laid out with the trainer and header on the left and its options on the right (top and bottom on two displays); the exported FireRed interface is described below. The arrows move the highlight, A steps the highlighted button to its next choice and B (Shift) steps back, and a click does the same (right click goes back). Every part comes in the whole palette in `scripts/character.gd` (black, white, grey, red, orange, yellow, green, teal, blue, navy, purple, pink, brown): a colour the part has drawn is used as drawn, the rest are recoloured from one drawn colour (blue first when there is one) by changing the hue of its coloured pixels only, so outlines, whites and greys stay. New parts appear by themselves, and one colour is enough: a folder per style under `assets/creator/sprites/overworld walk/<hair|tops|bottoms|hats|carrying stuff>/` holding one PNG per colour (or a single PNG for a style with one colour), the same file under `overworld run`, each a 128 x 128 sheet of 32 x 32 frames on a transparent background, rows facing down, left, right, up, columns stand, step, stand, step. A on DONE saves the look to `user://accounts/<Discord id>/character.json` (`local` with nobody signed in), so each account has its own trainer, and the hero wears it from then on. C on a keyboard or `--creator` opens it again. `--creator-art=<dir>` (or `JOURNEYS_CREATOR_ART`) points at another copy of `assets/creator`. Any test flag skips it; `--title` shows it anyway and `--autostart` presses A after a second. Data lookup uses `--data=<directory>`, then `JOURNEYS_HUB_DATA`, then `user://hub-data`. Only `data/layout.json` is loaded from the project. It holds the spawn and the named doorway markers, each with the building it stands for. `npcs` lists standing NPCs: `name`, `tile`, `facing`, `sprite` (an overworld texture file of the games, such as `captain_1`; `tools/hub/victory/frames.js` builds its sheet from the ROM extractions into `sprites/` and `npc-sprites.json`) and `text` pages, plus optional `move` (`still`, `look` to look around, `pace` back and forth along `axis` up to `range` tiles, `wander` within `range` tiles), `every` (seconds between moves), `offset` [east, up, south] in tiles (to seat someone on a bench), `blocks` (more tiles they cover; facing one talks to them) and `check: false` (for NPCs fenced off on purpose). Facing an NPC and pressing A shows its text; it turns toward the player while talking. An NPC with `"role": "journeys"` (the red ship's captain) then asks `ask` with a pick list of the journeys in `journeys.json` in the data folder (`[{"name": "Pokémon Emerald", "rom": "<path>"}, ...]`, written by the app; `--journeys=<file>` reads another) and a last `cancel` option, which B also picks. Up and down move the cursor and A picks; after the `sail` line (`%s` is the journey's name) the ROM path goes to the app's `PokeJourneys` Android plugin as `launch(rom)`, or is printed when the plugin is missing, as on a desktop. With no journeys it shows `none`. An NPC with `"role": "services"` asks `ask` with its `options` (`[label, what it opens]`: `creator`, `intro`, or `settings` for the app's settings) and `cancel`. An NPC with `"role": "vault"` (the PokeVault's clerk) asks `ask` with `open` and `cancel` and opens the app's Vault through the plugin's `open_vault()`; on a desktop the call is printed. `--check` also reports whether each NPC can be reached. To label a sign, add a string under `signs` keyed by tile, such as `"87,65": "Market square"`. Unlabelled signs display `This sign is blank.` `collision` fixes what the map's collision gets wrong: `open` tiles become walkable and `block` tiles become walls (an entry is `[x, y]` or `[x, y, lastX]` for a run along a row); `notFloor` names terrain-group models that are buildings or roofs, which still block but are never stood on; `cliffs` names sloped surfaces that are walls; `clear` tiles are opened and never blocked by props; `canopies` names models (parasols) that block the ground under them up to head height; `posts` names thin poles (parasols) that block just the tile their foot stands on; `passThrough` names models that never block. Besides these, any model at body height on a walkable tile blocks it, and each tree blocks the 2 x 2 tiles around its trunk. `seeThrough` names materials drawn blended, such as glass. The exporter applies all of these, so export again after changing them. `fillers` lists plain dark blocks (tile coordinates `x0`, `y0`, `x1`, `y1`, heights `bottom`, `top`, `color`) placed inside buildings whose models are open on a side, so see-through windows show an interior; they need no export. `animate` gives materials (matched by name) motion: `scroll` [u, v] slides a texture each second (water), `flip` seconds shifts it one pixel back and forth (flowers, like the DS frame swaps), `slosh` [distance, seconds] slides a texture back and forth (ship wakes), `pulse` [lowest, highest opacity, seconds] fades it in and out, `sway` [amount, speed] bends the upper part of a model in the wind (tree tops, bunting; see `shaders/sway.gdshader`). `rotors` turns windmill blades (pieces of a surface above `above`, grouped per windmill) about their hub over `seconds`; `spin` turns a wheel's surfaces about their axle over `seconds`, with each car kept upright. Neither needs an export. `node tools/hub/victory/frames.js` finds the original games' animation frames for the hub's textures in the ROM extractions (default `C:/Projects/hub-work/{hg,pt,b2}-extract`, read with apicula): a texture matches a frame with the same size, transparency and colour pattern, and the set is recoloured to the texture's palette. It writes `frames/` and `frames.json` to the data folder; the hub flips through them (they replace a `scroll` or `flip` rule; `sway` still applies). `frameSeconds` sets seconds per frame by material name (`default` otherwise) and `noFrames` drops matches that are not animations. Run it again after an export that adds textures.

## In the Android app

The app's Gradle build exports this project with `export_presets.cfg` (`--export-pack Android`) and puts the files at the root of the APK's assets, with `assets/creator` as `res://creator`. It needs `pokejourneys.godot=<path to Godot_v4.7.2-stable_win64_console.exe>` in `local.properties` (or `GODOT`); without it the APK has no hub. A normal app start opens the island over the library (`app/.../journeys/HubActivity.kt`, in its own `:hub` process); leaving it goes back to the library. The app writes `journeys.json` from the library's games, and the `PokeJourneys` plugin's `launch(rom)` starts the game (`JourneyLaunchActivity.kt`), which records the journey for the Vault when it closes and returns to the island. The plugin's `open_vault()` and `open_settings()` open the Vault and the app's settings over the island (`HubPageActivity.kt`). On a second screen the app shows the hub companion (`HubCompanion.kt`): the trainer's card and a SETTINGS button; the creator's and the journey menu's bottom screens cover it while they are open.

The exported data stays out of the APK: the phone builds it from the player's own cartridges on first run (`app/.../journeys/HubBuildActivity.kt`). It needs FireRed (English, Rev 1), HeartGold, Platinum, Black and Black 2 in the library and lists any that are missing. The build runs `tools/hub/build/hub-build.js`, which runs the same exporters as the PC, under QuickJS (`libqjs.so`, with `tools/hub/qjs/node.mjs` standing in for the part of Node they use) and apicula (`libapicula.so`), into `Android/data/com.pokejourneys.app/files/hub-data`. It writes `build.json` last; the hub opens only when that file's version matches the app's (`HubBuildActivity.BUILD_VERSION`, the same number as `VERSION` in `hub-build.js`; raise both when the build's output changes).

What ships is the owner's design only: `tools/hub/build/rooms.json` (which game room each door opens) and `tools/hub/build/island/`, made from the island export by `node tools/hub/victory/island-recipe.js`. That holds the walk grid, cells and signs, and the island's meshes as skeletons: every corner that comes from a game model is a reference (model, corner, where the tile stands), filled on the phone from apicula's conversion of that model, and every texture is an apicula job on the cartridge. Run it again after exporting the map. Its report (`C:/Projects/hub-work/island-recipe/recipe-report.txt`) lists how each tile was matched to its game model. `node tools/hub/victory/compare-meshes.js <export> <rebuilt>` checks a rebuilt island against the export, and `node tools/hub/qjs/compare.js <pc data> <phone data>` checks a phone build against a PC one (PNGs by pixels). The same build runs on a PC with Node:

```powershell
node tools/hub/build/hub-build.js --firered <gba> --heartgold <nds> --platinum <nds> --black <nds> --black2 <nds> --apicula <apicula.exe> --data <out> --work <scratch>
```

Textures with no exact match in the games are replaced by the closest game texture (`tools/hub/victory/substitutes.json`). The ferris wheel is drawn as apicula poses its model, and the four harbor pieces drawn on a made-up texture are replaced by game props of their kind (`REPLACE` in `island-recipe.js`).

Followers on Android (the player's, other players' and bots', and on trainer cards) come from the Generation 8
Pack's sheets bundled in the app (`app/src/main/assets/followers`, credited in CREDITS.md). A copy of
`Graphics/Characters/Followers` and `Graphics/Characters/Followers shiny` under `hub-data/followers/`, with the
original file names, is used first.
The hub uses the species' base or female walking sheet, with a shiny sheet for a shiny Pokémon when available.
Missing sheets fall back to the art available from the player's journeys. The pack stays on the device.

For the optional Stadium emblems, place the 260×846 sprite sheet in `hub-data/versus-badges.png`.
The card uses the Poké Ball, the first five star emblems, and the winged six-star emblem in each supported color.

The captain lists recognized DS cartridge releases even when the companion lacks a memory reader for them.
Known alternate dumps are labeled ROM variant and listed under their generation. They keep the Vault restrictions
for non-retail journeys.

The hub interface uses FireRed's default field menus, NPC dialogue window, normal font and native naming screen when exported from the player's English FireRed Rev 1 cartridge:

```powershell
node tools/hub/victory/gba2d.js firered '<FireRed Rev 1 .gba>' 'C:/Projects/hub-work/victory-island-data'
```

The exporter checks game code BPRE and revision 1 before writing anything. Other cartridges are rejected. It writes only to the external data folder's `ui/firered`: tile sheets, palettes and naming positions in `metadata.json`, menu arrow, normal and Copy1 AngelCode bitmap fonts, naming maps and sprites. Copy this folder to the device with the rest of the data; no cartridge pixels or fonts go in the repository or APK. `scripts/gba_frame.gd` shares tile-frame drawing, arrow and font loading. GBA artwork uses whole physical-pixel scales and nearest filtering.

The Battle Dome draws FireRed's battle interface from the same cartridge:

```powershell
node tools/hub/victory/battle-ui.js '<FireRed Rev 1 .gba>' 'C:/Projects/hub-work/victory-island-data'
```

It has the same checks and writes only `ui/firered-battle`: the BG0 textbox with its command and move menus and cursor, the four healthboxes, HP bar colours and status icons, the normal and small fonts (glyph values stored as pure red, green and blue for recolouring), the Poké Ball and its opening sparks, Red's and Leaf's back pictures and two opponents, every battle terrain, and the move-effect sprites by animation tag, with `battle-ui.json` describing windows, text colours, positions and per-species picture offsets from FireRed's own tables. Previews go to `C:/Builds/PokeJourneys/firered-battle/preview`. Copy the folder to the device with the rest of the data.

The creator has one field menu with BODY, HAIR, TOP, BOTTOM, BACK, HAT, NAME and DONE, with an arrow beside the selected row. Left/right chooses style or colour, A advances it, B steps back, and touching a choice does the same (right click steps back). The trainer keeps its rotating walk/run preview. With two screens, the trainer and header stay above and the choices use the existing bottom SubViewport and `show_bottom` transport. Naming uses one native GBA screen on one display; with two displays, the name box is above and the keyboard below. Its grouped upper/lower/others pages, BACK, OK, cursor, input arrow and underline come from the cartridge. Names remain limited to seven letters/digits. D-pad, A, B/delete, START/OK, SELECT/page, keyboard and touch remain supported.

Without FireRed data, each screen retains its earlier interface. Fonts, including characters absent from FireRed, fall back to the Platinum export at `ui/font`, then Pixel Operator. The earlier Platinum naming export remains supported: `node tools/hub/victory/ds2d.js namein <platinum.nds> <data folder>` writes `ui/namein` and its related font/buttons. `ds2d.js` reads the cartridge file system, NARC and NCLR / NCGR / NSCR / NCER formats; `list` and `narc` inspect the ROM. Without either naming export, the creator retains its original letter grid.

Discord sign-in (`app/.../journeys/DiscordSignIn.kt`) needs a Discord application: put its client id in `local.properties` as `discord.clientId=<id>` (or `DISCORD_CLIENT_ID`), and in the Discord Developer Portal, under OAuth2, add the redirect `discord-<id>:/authorize/callback` and turn on Public Client. The app signs in with PKCE, so it holds no client secret, and keeps the account in its private files.

Arrows/WASD or d-pad move. Shift or gamepad B runs. Holding L3 (Q on a keyboard) opens the hot wheel (`scripts/wheel.gd`): the left stick points at a tile, left and right step round it, letting go or A picks it and B closes it. Its tiles open the settings, the Vault and the creator, and SWAP (two screens; R3 or R does the same) changes the screen the app's menus open on; with one screen CARD opens the companion's window instead. Z, Enter, Space or gamepad A reads the sign in front of the player. Press it again to close the message. Escape quits.

Run the reachability check without a display:

```powershell
& $godot --headless --path hub/victory -- --data=C:/Projects/hub-work/victory-island-data --check
```

`--check` follows every directed movement connection from the layout spawn using the player's step rules. It prints JSON with each doorway and sign and exits 0 only when all are accessible. A doorway is accessible on its marker tile or the tile immediately south; a sign needs an accessible adjacent reading tile on its known facing side. Unknown sign directions allow any adjacent side. `--at` does not alter the check's spawn.

Other flags go after `--`:

- `--at=x,y` starts on that tile.
- `--walk=uuddlr` queues tile moves; blocked moves still turn the player.
- `--talk` interacts after the queued moves; `--talk=N` presses A N times.
- `--shot=<absolute.png>` saves the field view after movement and interaction, then exits.
- `--grid` prints north-first collision rows.
- `--overview=<absolute.png>` saves a 2560 by 1536 top-down view of the whole map, then exits.
- `--speed=4` speeds up scripted movement.
- `--wheel=N` opens the hot wheel with its Nth tile (from 0) pointed at, for a `--shot`.

```powershell
& $godot --path hub/victory -- --data=C:/Projects/hub-work/victory-island-data --at=86,59 --shot=C:/Projects/hub-work/victory-island-data/spawn.png
& $godot --path hub/victory -- --data=C:/Projects/hub-work/victory-island-data --overview=C:/Projects/hub-work/victory-island-data/overview.png
```

Screenshots and overviews need a rendering display; `--check` works headless. Camera, sprite framing, walk/run timings and sampled stair paths retain the owner's reference settings.

## Other players

`scripts/others.gd` shows the other players in the same room, over the PokeJourneys server's live connection
(`server/journeys-server/README.md`, "Live connection"). It sends where this player stands (`island`, or the
interior's room name), their look from the creator and short updates when they turn, and draws everyone else:
their trainer (a look with only `gender` and `seed`, as test bots send, is made up from the seed), their
follower walking one tile behind, and a name tag above each head, this player's too (white text on a
see-through dark box; ` · AFK` or ` · Shopping` after the name). Other players don't block the way.

In the app the `PokeJourneys` plugin's `live_connect()` answers `live_ready(url, token, message)` for the server
chosen in Settings (nothing is shown when offline), and `remote_follower(request, species, shiny)` answers
`remote_follower_ready(request, png)` with that Pokémon drawn from this player's own journeys (empty when none
has it; shiny colours aren't drawn yet). On a PC, `--live=http://127.0.0.1:5281` signs in a test player with a
server's development sign-in (`--live-name=Name`); followers there show only for the island's own Pokémon. With
the server's bot players running, this shows a crowd:

```powershell
& $godot --path hub/victory -- --data=C:/Projects/hub-work/victory-island-data --live=http://127.0.0.1:5281 --live-name=HubTest
```

INTERACT on the quick actions wheel (in SWAP's place; R3, or R on a keyboard, still swaps the screens) lists the
other players on screen, nearest first, friends marked `(friend)`. Picking one offers their trainer card (Rating,
Experience and Battle Points from the server, then the story, journeys and follower they share), Add friend,
Message (opens a private conversation ready for typing), a trade request and a battle request. Requests sent to
this player wait until they're free, then ask Accept or Decline; messages and answers show as pages. An accepted
trade opens the trade window (`scripts/trade.gd`) for both players: their own Vault on the left (shiny Pokémon in
green), both offers on the right, CONFIRM and CANCEL below. Picking a Pokémon offers it (red); a new offer clears
both confirmations; when both confirm the server swaps them and both see what they sent and received. B or CANCEL
cancels for both. `--trade-demo` opens it with sample offers for a `--shot`. Accepting a battle request opens a casual
Random Singles battle on both phones using the Battle Dome's engine. The server relays choices; both phones generate
the same teams and simulate from its seed. These battles have no Vault selection or rewards. On a PC, the hub prints
the battle invitation instead. See [the battle tools](../../tools/battle/README.md) for the relay and checks.

CHAT on the wheel, or T on a PC, opens `scripts/chat.gd`. It is a floating window in the top-right corner of the
main screen, about half the screen tall, so the island stays in view and the device's keyboard leaves the draft
visible; the bottom screen keeps the trainer card. B (Escape on a PC) backs out of typing, then closes chat. Walking is locked while chat is open,
and message boxes keep their own controls.

Global chat reaches everyone online, across rooms. Each private conversation has its own tab; `*` marks unread
messages. Left/right changes conversations; up/down, the mouse wheel or touch dragging
scrolls messages, with the newest at the bottom. The window is drawn like FireRed's menus, in GBA
pixels at a whole number of screen pixels each: the conversation between arrows (a red `!` marks unread elsewhere),
QUICK and CLOSE on top, messages as `NAME: text` with names in FireRed's blue (others),
green (you) or red (server notices), and the draft on one line in the same menu frame, with SEND beside it. The font's other
colours are recoloured copies of the exported sheet, written to `user://chat-font`. It shortens while the device
keyboard is up so the text box stays above it. A, TYPE or touching the message box starts typing and
opens the device's own keyboard; its letters, backspace and enter arrive as key events, and A or SEND sends. B
closes the keyboard. A PC keyboard can type directly,
Backspace deletes,
Enter sends, and Tab changes conversations. X (F2 on a PC), or QUICK, offers the familiar set phrases to put in the
draft. Drafts stay with their conversation. Messages are trimmed and limited to 200 characters; sends are at least
one second apart. Offline and refused sends show an error and keep the draft available to retry.

Chat uses the same live connection: `chat_history` loads the last 50 global and 50 private messages, `chat` adds
new lines, and `chat_deleted` removes a deleted line. Private messages can reach offline players and return in
their history. Server notices appear in a different colour under the name Server, and a new notice also appears
once as a top-screen page when the player is free. History does not replay notice pages.

`--chat` opens Global ready for typing without the title screen; `--chat=ID` opens that player's private chat.
Combine it with `--live`, `--shot-delay` and `--shot` to capture the populated panel, for example:

```powershell
& $godot --path hub/victory -- --data=C:/Projects/hub-work/victory-island-data --at=47,64 --live=http://127.0.0.1:5281 --live-name=HubTest --chat --shot-delay=3 --shot="$env:TEMP/hub-chat.png"
```

`--shot-delay=S` waits S seconds before a `--shot`, so other players have arrived. `--interact` opens the INTERACT
list for a `--shot`; `--interact=0,1` then picks the first player and their second action, and `a` presses A on a
page.

## Building interiors

Export the rooms from the owner's cartridges into external data:

```powershell
node tools/hub/victory/interiors.js
node tools/hub/victory/interiors.js --rom 'C:/Projects/roms/Pokemon HeartGold (U)(Xenophobia).nds'
node tools/hub/victory/interiors.js --rom 'C:/Projects/roms/Pokemon - Black 2.nds'
# Optional: --data <external data directory>
```

The exporter follows cartridge zone headers, matrices, area texture references, furniture placements and warp events. It prints each room's zone and file indices. OBJ/MTL/PNG models, materials, `walk.json` and `room.json` go to the external data folder's `interiors/<room>/`; copy that folder to the device with the island data. Installed apicula, Node and JDK 17 / DS Map Studio libraries are reused. All three games use 16 DS units per island tile. Models retain native dimensions and placements; no fitted scale is applied. Spear Pillar joins its four blocks at native 32-tile offsets. Black 2 reads WB/GC map containers, bundled furniture and ground-layer permissions; the mall's upper-floor permission layer is not merged into the ground floor.

| Room flag | Door | Cartridge room | Zone / matrix / land |
|---|---|---|---|
| pokemart | PokeMart | Platinum Jubilife Mart | 4 / 122 / 190 |
| pokevault | GreenMarketShop | Platinum Global Terminal 1F (GTS) | 28 / 205 / 278 |
| daycare | Daycare | Platinum Solaceon Day Care | 437 / 137 / 195 |
| battlehall | BattleDome | Platinum Battle Hall | 563 / 253 / 322 |
| trainertower | BattleTower | Platinum Battle Tower lobby | 326 / 193 / 266 |
| villa | Unlinked | Platinum Resort Area villa, unfurnished base room | 464 / 264 / 331 |
| tmshop | WhiteMarketShop | Platinum Veilstone Store 3F (TM floor) | 139 / 174 / 251 |
| movereminder | PhotoShop | Platinum Pastoria east house | 129 / 125 / 182 |
| spearpillar | Shrine | Platinum normal Spear Pillar | 220 / 22 / 375�378 |
| gamecorner | GameCorner | HeartGold retained Japanese Goldenrod Game Corner (machines) | 183 / 109 / 227 |
| battlestadium | BattleStadium | Black 2 PWT lobby | 192 / 265 / 981 |
| auctionhouse | GoldMarketShop | Black 2 Shopping Mall Nine ground floor | 350 / 90 / 873 |
| namerater | TentShop | International HeartGold Goldenrod Name Rater house | 206 / 140 / 280 |
| gamelounge | PurpleMarketShop | International HeartGold Goldenrod Game Corner (Voltorb Flip lounge) | 536 / 286 / 381 |
| cosmetics-veilstone | Unlinked preview | Platinum Veilstone Store 4F (dolls and decorations) | 140 / 175 / 252 |
| cosmetics-b2 | Unlinked preview | Black 2 Driftveil Market (herbs and incense) | 105 / 60 / 861 |

The former Sandgem laboratory has been replaced by GTS in `pokevault`; discard any earlier lab export before exporting GTS. The Mystery Gift Tent at (20,32) uses the Goldenrod Name Rater house, matching the island's `ko_seimei` building. Its Harlequin uses the `gsleader15_1` overworld sprite. The Hyperbolic Time Chamber trainer in `spearpillar` uses `gsbigfour3_1`. PurpleMarketShop uses `gamelounge`. The Veilstone and Driftveil cosmetics rooms remain separate previews, available with `--room=cosmetics-veilstone` and `--room=cosmetics-b2`.

`layout.json` links named doorways with `"interiors": [{"door": "PokeMart", "room": "pokemart"}]`. Press north from the doorway or the tile immediately south to enter. Step onto the room's exit tile in its exit direction to return south of that door. Battle Hall and the TM floor exit east; other rooms exit south. Both transitions fade over 0.25 seconds per side. Rooms use the island camera, player and grid rules, with black outside the model. Unmapped doors and missing rooms print one line and stay on the island. An `interiors` entry may list `npcs`, written like the island's but in the room's own tiles; `blocks` lets a clerk behind a counter be talked to across it.

For an additional supported room, `--rooms <external.json>` accepts an array of `{"room":"name","zone":123}` definitions. Use `warp` to select an entrance from multiple cartridge warps, `exitWarps` for adjacent exit tiles, `exitFacing` for the outward tile direction (default `[0,1]`), and optional `entry`. The shared output manifest contains `entry`, `exits`, `exitFacing`, `size`, `meshes` and source indices/transforms. Only the selected external exits return to the island. Optional `links` entries (`tile`, `room`, `arrival`, `facing`, with optional `direction`) connect floors through the same fade and preserve the island return tile. An upper floor can use `exitWarps: []` and an explicit `entry`; its stairs belong in `links`. Optional `mirror` lists furniture target tiles: facing one and pressing A opens the character creator; an empty list means no mirror, dresser or wardrobe was found. The exporter copies `links` and `mirror` from the external room definitions. Black 2 definitions may set `propNorthPositive: true` when placement Z follows the room model north axis; raw placements and the selected convention remain in `source`. Furniture yaw is preserved; unsupported rotations and map formats are rejected. Cartridge permission walls remain blocked; nearby native floor geometry supplies foot heights and stair profiles, with corrections recorded in `room.json`.

`--room=villa` starts in the unlinked villa; `--room=pokevault` starts in GTS. Combine with `--at=x,y` (room coordinates), `--walk`, `--grid` and `--shot`. `--check` checks the island, linked interiors and all other exported room folders, including the villa. A directly started unlinked room returns to the island spawn on exit.

```powershell
& $godot --path hub/victory -- --data=C:/Projects/hub-work/victory-island-data --room=pokevault --walk=uuuuuuuu --shot=C:/Projects/hub-work/interior-shots/pokevault-walk.png
& $godot --path hub/victory -- --data=C:/Projects/hub-work/victory-island-data --at=34,29 --walk=ur --shot=C:/Projects/hub-work/interior-shots/battlehall-back.png
```

See [CREDITS.md](CREDITS.md) for component sources.

To reproduce the comparison captures, run:

```powershell
node tools/hub/victory/compare.js
```

This creates a reference copy in the external data folder, four paired field screenshots, both overviews, side-by-side PNGs and `compare/pixel-comparison.json`. It never edits the source reference project. `--prepare-only` prepares the copy without captures; `--data <directory>`, `--reference <project>` and `--godot <executable>` override its paths.

Exporter defaults point to the supplied `FrontierTerracesAligned.pdsmap`, the owner's reference Godot export, and the installed DS Map Studio 2.2 libraries. Override them with `--map <file>`, `--reference <folder>`, `--data <folder>`, `--lib <folder>`, `--java <JDK folder>` or `--godot <executable>`. `JAVA_HOME`, `DSMS_LIB` and `GODOT` also supply tool locations. Godot is needed during export to inspect the reference's saved meshes and materials. Generated Java classes and inspection caches stay under the external data folder's `.build/`.

The exporter matches tile textures against the reference's terrain/buildings/decorations surfaces, then reports its classifications for new textures. It uses DS Map Studio's own OBJ writer at scale 1.0. `materials.json` beside each OBJ preserves the reference's nearest filtering, depth bias and translucent shadows. Source model placements and dimensions remain authoritative. A boardwalk tile whose model runs past its footprint (such as's Bridge.obj) overlaps the next copy at the same height; overlapping copies go to the `deck` and `deck2` meshes, drawn 0.012 and 0.02 higher, so they never flicker.

Collision comes from the newest `.per` files. Height plates come from DS Map Studio's gameindex 2 `.bdhc` reader; terrain samples provide stair profiles and replace stale plates where visible terrain differs by more than 0.02 tiles. Each correction is listed in `export-report.txt` and `walk-diagnostics.json`. The exporter keeps authored blocked cells blocked. The `.bdhcam` files do not override the reference's field camera; empty `.bld` sidecars add no separate models.

Output includes three OBJ/MTL/texture folders, `walk.json`, `signs.json`, `sprites.json`, `sprites/hero.png`, `cells.json`, `walk-diagnostics.json` and `export-report.txt`. Repeated exports validate cached source and mesh hashes and produce the same data bytes. The reference doorway markers remain in place even when the latest map replaces a building; the report lists each expected building's current placement or absence.

The Journey captain uses Black 2's dark menu with generation, game and SAIL/BACK pages. Only installed generations appear; unofficial games always go under ROM hacks. A/d-pad/B and touch work, with lists on the second screen and details above, or both side by side on one screen, at whole-number DS pixel scales. Long selected game names scroll; details wrap.

Export the menu from your own Black 2 cartridge (IRE*) into the external hub data, alongside Platinum's existing `ui/font` export:
```powershell
node tools/hub/victory/ds2d.js captain 'C:/Projects/roms/Pokemon - Black 2.nds' C:/Projects/hub-work/victory-island-data
```
This writes `ui/captain/{active,dim,background,cursor}.png` and `slices.json` (6-pixel horizontal, 5-pixel vertical caps). Without these pieces or `ui/font`, the captain keeps the message-box list. The app supplies name, ROM, generation and official status in `journeys.json`; no save is opened for this menu.

Homes: the BattleTower door (Trainer Tower) leads to `home-b2-1f`, whose bedroom drawers open the character creator. The other homes are unlinked previews: `home-pt-1f` / `home-pt-2f` (Twinleaf, zones 414/415), `home-hg-1f` / `home-hg-2f` (New Bark, zones 63/64); Aspertia is zone 428. Aspertia has a partitioned bedroom on the same floor, so there is no `home-b2-2f`. The Platinum and HeartGold pairs use native stair warp tiles. Their bedrooms have no mirror/dresser/wardrobe targets; Aspertia has bedroom drawers at `(11,1)` and `(12,1)`. All exports and captures stay in the external data workspace.
