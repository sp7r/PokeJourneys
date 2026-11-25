# Credits

## PokeDaisy

**Based on PokeDaisy by Lidor Itzhari - https://github.com/lidor30/pokedaisy**

PokeJourneys is a fork of PokeDaisy (GNU GPL 3.0 with an additional attribution term, see [NOTICE](NOTICE)). The
Android app, its emulator integration, dual-screen support, companion, docs and tools are PokeDaisy's. Its third-party
components are listed in [NOTICE](NOTICE) and shown in the app under Settings > LICENSES.

## Added by PokeJourneys

| Component | Used for | Authors | License | Source |
| --- | --- | --- | --- | --- |
| PKHeX.Core | The save bridge (`src/Journeys.Core`, in the app as `libjourneys.so`): saves, conversion between generations, encounter generation, legality checks | Kaphotics and the PKHeX contributors | GPL-3.0-or-later | https://github.com/kwsch/PKHeX |
| .NET runtime | Runs the save bridge, compiled ahead of time | .NET Foundation and contributors | MIT | https://github.com/dotnet/runtime |
| apicula | Converts the DS models in the player's own ROMs on first run (in the app as `libapicula.so`, built without its viewer: `tools/apicula/no-viewer.patch`) | scurest and contributors | 0BSD | https://github.com/scurest/apicula |
| QuickJS (quickjs-ng) | Runs the hub's build scripts (`tools/hub`) on the phone to make the hub data from the player's own ROMs (in the app as `libqjs.so`) | Fabrice Bellard, Charlie Gordon, Ben Noordhuis, Saúl Ibarra Corretgé and contributors | MIT | https://github.com/quickjs-ng/quickjs |
| SSEQ Player | Plays the songs in the player's own DS cartridges to make the hub's music (`app/src/main/cpp/journeys/music/sseqplayer`, in the app as `libhubmusic.so`; marked "PokeJourneys" where changed to find a song's loop) | Naram Qashat (CyberBotX), from the FeOS Sound System by fincs | WTFPL | https://github.com/kode54/SSEQPlayer |
| QOA | Compresses the hub's music (`app/src/main/cpp/journeys/music/qoa.h`, in `libhubmusic.so`) | Dominic Szablewski | MIT | https://github.com/phoboslab/qoa |
| Godot Engine 4.7.2 | Runs Victory Island (`hub/victory`) in the app (`org.godotengine:godot`, `libgodot_android.so`) | Juan Linietsky, Ariel Manzur and the Godot Engine contributors | MIT (bundled libraries: [Godot-COPYRIGHT.txt](third_party/licenses/Godot-COPYRIGHT.txt)) | https://godotengine.org |
| Character Customization Resources (Gen 4) | Character creator parts (`assets/creator/`) | Coffee Cup / Poltergeist | "You can freely edit, use and share the files." | https://eeveeexpo.com/resources/317/ |

The character parts' author describes them as made from scratch, partly starting from the original games' sprites.
The hub's components are listed in [hub/CREDITS.md](hub/CREDITS.md).
The interior height readers reference the BDHC format research by mikelan98 and JayT
([BDHC files](https://projectpokemon.org/home/forums/topic/37816-gen-iv-bdhc-files-terrain-settings/)),
[Hiro TDK's file specifications](https://hirotdk.neocities.org/FileSpecs), and the Generation 5
permission format and numerical distance lookup documented by Gonhex and Trifindo
([Map Containers](https://ds-pokemon-hacking.github.io/docs/generation-v/resources/bw_b2w2-maps/)).
Battle Dome practice and battles between players use [Pokémon Showdown](https://github.com/smogon/pokemon-showdown) through
[`@pkmn/sim` and `@pkmn/randoms`](https://github.com/pkmn/ps), with `@pkmn/sets`, `@pkmn/streams`, and
`ts-chacha20` (MIT licenses). Showdown supplies battle mechanics, Smogon formats, team validation, and competitive
opponent sets. Battle messages use Showdown's text templates through `@pkmn/view` and `@pkmn/protocol` (MIT), the same
pkmn project. The battle screen is FireRed's own battle interface, exported from the player's FireRed cartridge into
external hub data by `tools/hub/victory/battle-ui.js`; its layouts, window and text settings, healthbox and HP bar
rules, sprite placement and animation sprite choices follow pret's [FireRed decompilation](https://github.com/pret/pokefirered)
and its Rev 1 symbol map. The interface also uses the player's local Pokémon art. esbuild (MIT) bundles the browser code at
build time.
The Gen 3 debug editor's flag IDs reference the [FireRed](https://github.com/pret/pokefirered),
[Emerald](https://github.com/pret/pokeemerald), and [Ruby](https://github.com/pret/pokeruby) decompilations by pret.
The new-journey handoffs reference those projects' initialization routines and symbol maps, together with
[Platinum](https://github.com/pret/pokeplatinum), [Diamond](https://github.com/pret/pokediamond), and
[HeartGold](https://github.com/pret/pokeheartgold)'s intro and naming structures.
The hub's songs are found by the sound archives' sequence numbers, with Platinum's and HeartGold's map music from
pret's [Platinum](https://github.com/pret/pokeplatinum) and [HeartGold](https://github.com/pret/pokeheartgold)
decompilations.
GB/GBC startup routines and sprite locations follow pret's [Red](https://github.com/pret/pokered),
[Yellow](https://github.com/pret/pokeyellow), [Gold](https://github.com/pret/pokegold), and
[Crystal](https://github.com/pret/pokecrystal) symbol maps. Gen 5's process and trainer structures reference
[Project Holon's aletheia](https://github.com/Project-Holon/aletheia), checked against the player's cartridges.
Stadium badges take inspiration from the separate skill and experience measures in
[Bungie's Halo 3 ranking overview](https://bnetarchive.haloman30.com/news/content5147.html?cid=14994&type=topnews).
The optional Stadium emblem sheet supplied by the player credits redblueyellow for the sprite rip.
The sheet is kept in local hub data and omitted from the app and repository.

The hub's follower Pokémon (the player's, other players' and bots', and on trainer cards) are the follower
overworld sheets of the **Generation 8 Pack**, a Pokémon Essentials resource compiled by Golisopod User and
UberDunsparce, bundled unchanged in the app as `assets/followers` (a local copy in the hub data's `followers/` is
used first). Overworld sprites by:

- Gen 1-5: MissingLukey, help-14, Kymoyonian, cSc-A7X, 2and2makes5, Pokegirl4ever, Fernandojl, Silver-Skies,
  TyranitarDark, Getsuei-H, Kid1513, Milomilotic11, Kyt666, kdiamo11, Chocosrawlooid, Syledude, Gallanty,
  Gizamimi-Pichu, Zyon17, LarryTurbo, spritesstealer
- Gen 6: princess-pheonix, LunarDusk, Wolfang62, TintjeMadelintje101, piphybuilder88
- Gen 7: Larry Turbo, princess-pheonix
- Gen 8: SageDeoxys, Wolfang62, LarryTurbo, tammyclaydon

The pack's full credits list is kept in `third_party/licenses/Gen8-Pack-credits.txt` and shown on the app's
licenses screen. Bundling these sheets is a one-time exception to the project's rule of shipping no game-derived art.

Diamond and Pearl's US cartridge checksums come from [pret/pokediamond](https://github.com/pret/pokediamond).
The Platinum US Rev 0 checksum is documented by the [My Pokémon Ranch Platinum patch project](https://projectpokemon.org/home/files/file/5900-wiiware-my-pok%C3%A9mon-ranch-platinum-version-english-usa-update-patch/).

## Server

These components run in `server/journeys-server` and do not ship in the Android app.

| Component | Used for | Authors | License | Source |
| --- | --- | --- | --- | --- |
| Microsoft.Data.Sqlite | SQLite storage for server records and the admin audit log | .NET Foundation and contributors | MIT | https://github.com/dotnet/efcore |
| SQLitePCLRaw | Native SQLite bindings used by Microsoft.Data.Sqlite | Eric Sink and contributors | Apache-2.0 | https://github.com/ericsink/SQLitePCL.raw |
| SQLite | Embedded database engine | SQLite authors | Public domain | https://sqlite.org/copyright.html |
| ASP.NET Core | Server HTTP API and static admin console hosting | .NET Foundation and contributors | MIT | https://github.com/dotnet/aspnetcore |

## Games and trademarks

Pokémon, the Pokémon logo and all related names are trademarks of Nintendo, Creatures Inc. and GAME FREAK inc.
PokeJourneys Online is a free, unofficial fan project with no connection to or endorsement from any of them. No
ROMs, BIOS files or other game data are included.
