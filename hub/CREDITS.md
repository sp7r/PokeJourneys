# Hub tools

These tools make Victory Island's data on the developer's machine; they do not ship in the Android app. The island
itself and its other credits are in [victory/CREDITS.md](victory/CREDITS.md).

* [apicula](https://github.com/scurest/apicula), by scurest, 0BSD. External executable used for Nitro model decoding and conversion. No source copied.
* [Pokemon DS Map Studio](https://github.com/Trifindo/Pokemon-DS-Map-Studio) 2.2, by Trifindo, GPL-3.0. External editor used to paint the hub island's ground and export it as OBJ/MTL. `tools/hub/dsms/` compiles against its jars at build time on the developer's machine (map reading, tile rendering and its own OBJ writer); none of its code, jars or bundled tilesets are copied into this repository or the hub build. The tile textures come from its bundled Platinum, HeartGold/SoulSilver and Black 2/White 2 tilesets and stay in the developer's local hub data.
* Island terrain is generated from `tools/hub/dsms/victory-design-1to1.js` with `victory-map.js` and exported with `ExportObj.java` (Pokemon DS Map Studio's own reader and OBJ writer, as above). Buildings, props and overworld sprites are the player's own ROM models and sprites (apicula output, HGSS overworld sheets), loaded at runtime from a data folder outside the repository and the APK.
* The Stadium greeters, Battle Dome attendants and Pokémon Spotter use overworld sprites from the player's Pokémon HeartGold export (GAME FREAK inc.), stored in the local hub data.
* The Poké Mart, TM Shop and Decorations clerks, Daycare keeper, Move Tutor and Auctioneer use Sinnoh overworld sprites available in the player's Pokémon Platinum export (GAME FREAK inc.), stored in the local hub data.

Game models, textures and derived images belong to their respective owners. None are distributed here.
