# Desktop map tools

These tools do not ship in the Android app.

* [apicula](https://github.com/scurest/apicula), by scurest, 0BSD. External executable used for Nitro model decoding and conversion. No source copied.
* [libGDX](https://github.com/libgdx/libgdx), Apache License 2.0. Rendering API, LWJGL3 desktop backend and Android backend, version 1.13.1.
* [gdx-gltf](https://github.com/mgsx-dev/gdx-gltf), Apache License 2.0. glTF loading and material shaders, version 2.2.1.
* [LWJGL](https://github.com/LWJGL/lwjgl3), BSD 3-Clause. Transitive desktop native binding dependency, version 3.3.3.
* gdx-jnigen-loader, Apache License 2.0; JLayer and JOrbis, LGPL. Transitive libGDX desktop dependencies. Audio is disabled.

Game models, textures and derived images belong to their respective owners. None are distributed here.

## Playable hub

* [gdx-controllers](https://github.com/libgdx/gdx-controllers), Apache License 2.0, version 2.2.3. Core input API, desktop and Android controller backends.
* [Jamepad](https://github.com/williamahartman/Jamepad), version 2.0.20.0, transitive desktop controller dependency. See its upstream license for the Java wrapper and bundled SDL/native components.
* [AndroidX](https://developer.android.com/jetpack/androidx) Core and its dependencies, Apache License 2.0. Transitive libGDX Android backend dependencies in the hub APK (`hub/game/android`, a separate test app, not the main Android app).
* HeartGold-style movement timings and field-camera values follow the earlier Godot overworld prototype (`C:/Projects/Godot pokemon`, the owner's own project); no code copied.
* The trainer uses the existing Eevee/Coffee Cup/Poltergeist character resources from `assets/creator/`. Their source and license credits are retained in the repository's [CREDITS.md](../CREDITS.md); no new character art was imported.
* GLB sidecar packing and vertex colour normalization reuse the existing `render/` implementation in this repository.

## Tile ground

* [Pokemon DS Map Studio](https://github.com/Trifindo/Pokemon-DS-Map-Studio) 2.2, by Trifindo, GPL-3.0. External editor used to paint the hub island's ground and export it as OBJ/MTL. `tools/hub/dsms/` compiles against its jars at build time on the developer's machine (map reading, tile rendering and its own OBJ writer); none of its code, jars or bundled tilesets are copied into this repository or the hub build. The tile textures come from its bundled Platinum, HeartGold/SoulSilver and Black 2/White 2 tilesets and stay under `C:/Projects/hub-work`.

## Godot hub (`hub/godot`)

* [Godot Engine](https://godotengine.org) 4.7.2, by Juan Linietsky, Ariel Manzur and contributors, MIT License (the engine's bundled third-party components are listed in its `COPYRIGHT.txt`). The hub runs on it; its Android export templates are installed on the developer's machine, not copied into this repository. The Godot hub APK is a separate test app for now; its license texts go into NOTICE when the hub ships inside the main app.
* Movement, field camera, overworld sprite animation, NPC behaviour and message box are adapted from the owner's earlier Godot overworld prototype (`C:/Projects/Godot pokemon`, the owner's own project).
* Island terrain is generated from `tools/hub/dsms/victory-design-1to1.js` with the existing `victory-map.js` and exported with `ExportObj.java` (Pokemon DS Map Studio's own reader and OBJ writer, as above). Buildings, props and overworld sprites are the player's own ROM models and sprites (apicula output, HGSS overworld sheets), loaded at runtime from a data folder outside the repository and the APK.
* The Stadium greeters, Battle Dome attendants and Pokémon Spotter use overworld sprites from the player's Pokémon HeartGold export (GAME FREAK inc.), stored in the local hub data.
* The Poké Mart, TM Shop and Decorations clerks, Daycare keeper, Move Tutor and Auctioneer use Sinnoh overworld sprites available in the player's Pokémon Platinum export (GAME FREAK inc.), stored in the local hub data.
