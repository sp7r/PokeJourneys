# Battle Dome handoff
Updated: November 18, 2026 (America/New_York)

## Immediate assignment

The owner requested two changes after testing the current build:

1. Make the battle interface look like the actual FireRed battle UI. Using assets from the owner's FireRed ROM is explicitly authorized.
2. Play battle animations and complete turn sequences instead of resolving everything instantly. The owner wants a full battle simulator presentation.

The owner then requested this handoff. Stop implementation at this boundary; continue with the two requests above in the next work session.

**Neither of these latest changes is implemented yet.** The installed build has working Showdown mechanics and a preliminary pixel theme, but the owner wants a closer reproduction of FireRed and animated playback. Only read-only research and reference downloads were performed for the latest requests.

## Workspace and rules

- Repository: `C:/Projects/PokeJourneys`.
- Read `AGENTS.md`, `docs/DECISIONS.md`, and `C:/Projects/hub-work/fable-brief.md`.
- No commits, pushes, history rewrites, or attribution lines in project material.
- Preserve the exact PokeDaisy notices.
- Keep upstream hooks small. The source package remains `com.pokedaisy.app`; the installed application ID is `com.pokejourneys.app`.
- Never put ROMs, saves, states, RAM dumps, or extracted game assets in the repository or APK.
- Decode game art from the owner's ROM into external local data. Existing examples are `tools/hub/victory/gba2d.js` and `backdrops.js`.
- New external code/dependencies require CREDITS.md and shipped license notices.
- Leave all existing unrelated changes alone. The workspace contains extensive uncommitted work from earlier phases, including intro skipping, custom trainer appearances, Vault, shops, and hub work.
- **Ask before every APK install.** The brief explicitly requires this because an install closes the owner's game. Prepare and verify the concrete signed build first. Do not interpret an earlier build's installation approval as blanket authorization.
- Only one Gradle build at a time. No active Gradle wrapper build was found when this handoff was prepared.
- Keep the work focused and reuse the existing helpers.

## Current installed build

- Device: AYN Thor, wireless ADB `10.0.0.13:37115`.
- APK: `C:/Builds/PokeJourneys/battle-dome-target-order-debug.apk`.
- SHA-256: `19BA8CFFF95AAA082695ACBD50E2EFD25E9EDB177A88C69AC45284ECE2958560`.
- Installed APK hash was verified on the device.
- Signing certificate SHA-256: `5669214d5ed5031750053a9b064506f1fd2a6a23ae33676550f7d7d4d85f46b3`.
- Application: `com.pokejourneys.app`, version 1.5.0.1 (20).
- Last intentional device state: Single Battles / Random Battle setup open, with no active test battle. The owner may have moved since.
- Complete prior feature report and changed-file list: `C:/Builds/PokeJourneys/battle-dome-verification.md`.
- Review screenshots and browser harness: `C:/Builds/PokeJourneys/dome-preview/`.
- Earlier APKs in C:/Builds are superseded. The target-order APK above is the installed baseline.

## What already works

- Battle Dome attendants: left Single Battles, middle Double Battles, right Triple Battles.
- Stadium remains ranked/casual PvP only. Do not move bot battles there or imply matchmaking is implemented.
- Offline Showdown simulation in Android WebView; no server or Android Node runtime.
- Build-time packages pinned in `tools/battle/package.json`:
  - `@pkmn/sim@0.11.0`
  - `@pkmn/randoms@0.11.0`
  - `esbuild@0.28.2` (build only)
- Random teams are the default. No Vault Pokémon are needed.
- Genuine Gen 7 Random Battle supplies both teams, species-balanced levels, and a hidden opposing team.
- Tier formats can assign legal random teams or use optional Vault teams:
  - Gen 7 singles: OU, Ubers, UU, RU, NU, PU, ZU, Little Cup.
  - Gen 7 doubles: Doubles OU and Doubles UU.
  - Gen 6 Battle Spot Triples, because Gen 7 removed triples.
- Tier levels: 100, Little Cup 5, Battle Spot Triples 50. Random Battle uses Showdown's own balanced levels.
- Real team validation, legal move targets, switching, forced replacements, Mega Evolution, Z-moves, Ultra Burst, and triples shifting are wired.
- Vault teams use read-only PK7 projections. Stored Pokémon/saves remain unchanged.
- Bot wins add exactly one Experience, preserving Rating and peak Rating. Forfeits/losses give no Experience.
- Return to hub confirms forfeiture; B cancels the prompt.
- Two WebViews: main simulator/field above, lightweight controls below. Single-display fallback includes both.
- Touch, D-pad, and joystick control handling.
- Opponent display order is reversed relative to its internal array so triples adjacency matches visible positions. Keep this correction.

## Code map

### Simulator and browser UI

`tools/battle/`:

- `formats.mjs`: desk whitelist, format metadata and standard levels.
- `opponent.mjs`: legal random tier teams, bot move policy, legal target options, PP/type metadata.
- `engine.mjs`: DomeBattle, randomBattle, validation, sequence numbers, private/public state projection.
- `browser.mjs`: main page boot, setup, choices, native frame emission, rewards.
- `controls.mjs`: secondary page state rendering and forwarding actions.
- `ui.mjs`: current DOM-based setup/field/moves/switches/confirmations and controller focus.
- `style.css`: current preliminary theme. Most field/HP/button styling is CSS; it is not authentic FireRed battle artwork.
- `build.mjs`: bundles JS/CSS and dependency licenses into generated Android assets.
- `test/engine.test.mjs`: 17 tests, including complete battles in all twelve formats.

The existing UI calls `DomeBattle.choose()`, resolves the turn synchronously, and renders the final snapshot immediately. There is no playback queue or move-animation renderer yet.

`state().log` contains the last 240 player-visible protocol lines, filtered using `extractChannelMessages(..., [1])`. For animation work, retain a reliable protocol cursor/delta so long battles do not lose events to truncation. Animate events in order; do not simply animate the final HP snapshot. Preserve privacy: no opponent private moves, EVs, or stats should leak into client frames.

New action controls must stay locked while playback is running and then resume on the actual current request/sequence. Existing duplicate/stale-choice protection should remain.

### Android

`app/src/main/kotlin/com/pokedaisy/app/journeys/`:

- `BattleDomeActivity.kt`: WebView origin/resource interception, native bridge, secondary Presentation, keys/stick, result awarding and return.
- `DomeArt.kt`: local Pokémon front/back art; fallback to follower sheets or local icons.
- `DomeRewards.kt`: atomic rank/reward ledger; match IDs deduplicate wins.
- `HubActivity.kt`: minimal `open_bot_battle(mode)` plugin hook.

Resource origin: `https://dome.pokejourneys.local/`. Network loads, file access, and content access are disabled. Resources must be served through the explicit intercept whitelist. The only FireRed theme asset exposed currently is `/theme/menu.png`, read from external hub data.

Result warning for playback: the native bridge currently awards a win when a frame reports `battle.ended && battle.won`. Make sure animated victory/result timing is handled intentionally; keep the reward ledger and exactly-once behavior.

Return uses `FLAG_ACTIVITY_REORDER_TO_FRONT` on HubActivity before finishing so bottom-screen touches do not leave controller focus on the launcher.

Godot hook: `hub/victory/scripts/battle_signup.gd`. Android plugin methods use dynamic dispatch; `plugin.has_method("open_bot_battle")` returned false even when the method existed. Follow the existing direct-call pattern.

### Vault export and build wiring

- `src/Journeys.Core/DomeRoster.cs`: clones/converts stored Pokémon and exports Showdown sets.
- `src/Journeys.Core/JsonFile.cs`: source-generated serialization.
- `src/Journeys.Cli/Program.cs`: internal `battle-roster` command.
- `app/build.gradle.kts`: npm dependency install, browser bundling, generated assets and license inclusion.
- Manifest entry for BattleDomeActivity already exists.
- Credits/notices/decision documentation were updated for the simulator.

## Checks already completed

- 17 simulator tests passed, including complete battles in all twelve formats, format bans, Species Clause, invalid moves, level projection, stale choices, forfeits, trainer-name collision, and true Random Battle behavior.
- 7 Android unit tests passed: DomeRewardsTest (2), StadiumRankTest (5).
- C# Release build and six synthetic read-only PK3-to-PK7 export checks passed.
- Browser smoke checks at actual Thor logical viewports and pixel density passed with an empty Vault.
- On-device checks: all three NPC launch paths, random assignment, live actions in singles/doubles/triples, valid targets, switching, forfeit cancellation/confirmation, sleep/resume, and controller focus after return.
- Final targeting check: rightmost Weavile could target visible adjacent Audino and Seviper, while Krookodile across the field was excluded.
- All six Vault file hashes matched before/after testing. Rating / Experience remained 1 / 0 after forfeiting test battles.
- No full on-device win was played to completion; reward persistence is unit-tested.
- APK signature and packaged asset bytes verified. No game art was packaged.

## Actual FireRed assets and research ready to use

Owner's ROM (read in place):
`C:/Projects/roms/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba`

Existing external data:
`C:/Projects/hub-work/victory-island-data/`

Already decoded:
- `ui/firered/`: menu.png, message-sheet.png, arrow.png, font.png/font.fnt, naming font/assets and metadata.json.
- `ui/creator-backdrop/firered-grass/`: battle.png (native 240×112 battle field including platforms), background.png, base.png, info.json.
- Additional FireRed terrain exports: long grass, cave and indoor.
- Device copy: `/sdcard/Android/data/com.pokejourneys.app/files/hub-data/`.

Existing reusable decoders:
- `tools/hub/victory/gba2d.js`: exports pal, lz, tiles, map, glyph and CODES.
- `tools/hub/victory/ds2d.js`: image creation, pixel placement, PNG output.
- `tools/hub/victory/backdrops.js`: terrain table and background composition.
- `hub/victory/scripts/gba_frame.gd`: existing bitmap-font/menu/dialogue composition used by the hub.
- `app/.../companion/data/RomArt.kt` and MonArt.kt: existing local art infrastructure.

Reference source already downloaded outside the repository:
`C:/Builds/PokeJourneys/firered-battle/reference/`
- firered-rev1.sym
- battle_interface.c
- battle_controller_player.c
- graphics.c

Primary origins:
- https://raw.githubusercontent.com/pret/pokefirered/symbols/pokefirered_rev1.sym
- https://raw.githubusercontent.com/pret/pokefirered/master/src/battle_interface.c
- https://raw.githubusercontent.com/pret/pokefirered/master/src/battle_controller_player.c
- https://raw.githubusercontent.com/pret/pokefirered/master/src/graphics.c

Useful **ROM file offsets** from the Rev 1 symbols (subtract 0x08000000 from GBA addresses):
- 0xD00000: gBattleInterface_Textbox_Gfx (LZ77, compressed length 0x4D8)
- 0xD004D8: gBattleInterface_Textbox_Pal (LZ77, compressed length 0x44)
- 0xD0051C: gBattleInterface_Textbox_Tilemap (LZ77, compressed length 0x22C)
- 0xD11B84: gBattleInterface_Healthbox_Pal (raw, 0x20 bytes)
- 0xD11BA4: gBattleInterface_Healthbar_Pal (raw, 0x20 bytes)
- 0xD11BC4: gBattleInterface_Gfx / healthbox elements (raw, 0xF00 bytes)
- 0xD1F340: gHealthboxSinglesPlayerGfx (LZ77, compressed length 0x2C4)
- 0xD1F604: gHealthboxSinglesOpponentGfx (LZ77, compressed length 0x190)
- 0xD1F794: gHealthboxDoublesPlayerGfx (LZ77, compressed length 0x194)
- 0xD1F928: gHealthboxDoublesOpponentGfx (LZ77, compressed length 0x194)
- 0xE7BB04: gBattleInterface_PartySummaryBar_Gfx (LZ77, compressed length 0x84)
- 0x24EEA4: FireRed terrain table (existing backdrops exporter already uses it)
- 0x1FF370 / 0x207370: normal font glyphs / widths, already decoded by gba2d.js.

These are research findings, not a completed exporter. Confirm ROM identity and output geometry before writing assets. Healthboxes use two 64×32 OAM pieces; read battle_interface.c for tile placement rather than assuming the compressed bytes form one ordinary row-major rectangle.

Additional local evidence:
- `C:/Projects/hub-work/ui-style-mockups/firered-offsets.json`
- `C:/Projects/hub-work/ui-style-mockups/firered-layout-notes.md`
- `C:/Projects/hub-work/creator-backdrop/fr-battle-bg.c`

## Animation research and unresolved architecture

No animation architecture was selected or implemented.

The latest investigation checked official Showdown rendering support:
- https://raw.githubusercontent.com/pkmn/ps/main/view/README.md
  explicitly says AnimatedBattle is unfinished; do not assume @pkmn/view provides a ready animated player.
- Official replay/animation engine files live under:
  https://github.com/smogon/pokemon-showdown-client/tree/master/play.pokemonshowdown.com/src
- Reference copies downloaded to:
  `C:/Builds/PokeJourneys/firered-battle/showdown-reference/`
  battle.ts, battle-animations.ts, battle-dex.ts, battle-tooltips.ts,
  battle-scene-stub.ts, battle-sound.ts, battle-log.ts.

Findings:
- The battle replay/animation engine (battle-*.ts) is MIT, while the full client is AGPLv3. Inspect exact dependencies before vendoring.
- BattleScene uses jQuery and imports move animation definitions, Dex, log, sound and tooltips.
- Some dependencies also reference client-main and client-connection. A standalone integration needs adapters or a careful subset.
- @pkmn/view currently supplies helpers/log formatting, not completed AnimatedBattle.
- The animation source describes most fx/ images as CC0, with specific exceptions and separate licenses. Pokémon sprite images are not covered by that statement. Do not bulk-copy assets or assume all client art can ship.
- No new animation package was installed and no upstream renderer was copied into the repository.

An alternative considered was a local ordered protocol playback renderer using ROM art and move-family effects. This is only an option, not an accepted implementation decision. The owner asked for convincing complete battle playback, not a token flash around the current instant snapshot.

Expected presentation includes send-outs, move effects, hits, HP changes, status effects, fainting, replacements and victory. Preserve simultaneous/multi-target and multi-hit ordering, transformations and field conditions, and prevent action input while a turn is playing.

## Build and device commands

Operational SDK/ADB: `C:/Android/Sdk`.
JDK: `C:/Program Files/Microsoft/jdk-17.0.20.101-hotspot`.
Godot: local.properties contains its configured executable.

PowerShell build environment:

~~~powershell
$env:JAVA_HOME='C:/Program Files/Microsoft/jdk-17.0.20.101-hotspot'
$env:Path="$env:JAVA_HOME/bin;$env:Path"
$env:ANDROID_HOME='C:/Android/Sdk'
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
$env:GRADLE_USER_HOME='C:/Users/spang/.gradle'
& 'C:/Program Files/Git/bin/sh.exe' ./gradlew :app:testDebugUnitTest --tests 'com.pokedaisy.app.journeys.DomeRewardsTest' --tests 'com.pokedaisy.app.journeys.StadiumRankTest' :app:assembleDebug '-Pkotlin.incremental=false' --offline --console=plain
~~~

- Native/Kotlin rebuilds take roughly 7–9 minutes. Asset-only packaging takes about 7–13 seconds.
- Build output: `C:/Builds/PokeJourneys/app/outputs/apk/debug/app-debug.apk`.
- Keep a log and stage a named verified APK. Do not install a mixed/stale build.
- Source edits during compilation can leave generated browser assets stale; run a final packaging pass after all edits settle and compare ZIP entries with the generated assets.
- Node tests: `npm test --prefix tools/battle`.
- Browser assets: `node tools/battle/build.mjs C:/Builds/PokeJourneys/app/generated/domeAssets`.
- Existing warnings: SDK path in local.properties is stale but ANDROID_HOME works; pinned ILCompiler advisory and PKHeX trimming warnings are pre-existing.
- Do not change unrelated dependencies merely to silence warnings.

Device:
- Reconnect with `adb connect 10.0.0.13:37115` if the device is missing.
- Always specify `-s 10.0.0.13:37115`; duplicate mDNS connections have occurred.
- Top logical display: 0. Bottom last observed logical display: 4. Rediscover after reconnect/reboot.
- Physical screenshot IDs from `dumpsys SurfaceFlinger --display-id`:
  top `4630946441858561667`, bottom `4630946482288158084`.
- Top: 1920×1080; bottom: 1240×1080; density 2.30625.
- Browser layout checks used CSS viewports 832×468 and 538×468 at that density.
- Launch exported LibraryActivity; it redirects to the hub. BattleDomeActivity is intentionally not exported, so shell am start cannot launch it directly.
- Do not add an exported debug activity just for testing.
- Screenshots: screencap to /data/local/tmp, adb pull to C:/Builds, inspect, then remove only those temporary files.
- Existing preview server script: `C:/Builds/PokeJourneys/dome-preview/server.mjs`; last intentional server was stopped. It can exercise setup/battle/preview, main/controls, random empty-Vault and tier modes. It is test infrastructure outside the repo.

## Efficient on-device navigation

Hub spawn is (47,63). Battle Dome door is (34,28). The room entry is (15,18).
Attendants stand at (11,5), (15,5), (19,5); interact from the row below.

Timed keyboard input works with Godot:
- `input -d 0 keyevent --longpress <direction>` moves about two tiles.
- One tile: `input -d 0 keycombination -t 120 <direction> 113`, then wait 260 ms.
- Directions: up 19, down 20, left 21, right 22. Confirm Enter 66.
- F3 (133) toggles the existing coordinate readout.
- Native BattleDomeActivity handles button A 96, B 97, D-pad and stick.
- After touching the bottom screen, an unspecified input display is useful to verify focus returns to the hub; use explicit display 0 for deliberate top-screen navigation.

Verified route from spawn after closing the welcome dialogue:
up 2, left 2, up 10, left 2, up 1, left 1, up 12, left 7, up 9, left 1, up 1.
This enters the Dome. Wait for the transition, then up 12 to (15,6).
Go left 4 for singles, stay for doubles, or right 4 for triples.
Face up, Enter to speak, Enter to finish the greeting and open battle setup.

## Suggested next steps

1. Read the active renderer and authoritative FireRed source/asset references above.
2. Decide how to reuse the official animation engine or implement complete ordered playback; verify the dependency/licensing boundary.
3. Export authentic FireRed battle textbox/menu/HP/font assets from the supplied ROM into external hub data only. Inspect them at native size.
4. Replace the current approximate battle field and command panels with the real FireRed layout while preserving dual-screen controls and all supported modes.
5. Add timed playback and input gating; ensure native reward timing remains correct.
6. Test visible sequences and state ordering, not just simulator final results. Cover multi-hit, switching, faint/replacement, status, doubles/triples targets and leaving during playback.
7. Finish all native changes before starting the one long Gradle build. Preview at Thor density, build, verify licenses/signature and stage a concrete APK.
8. Ask the owner before installing. Then verify on both Thor screens without modifying stored Pokémon or journey saves.

