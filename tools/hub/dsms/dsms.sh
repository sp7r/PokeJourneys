#!/bin/sh
# Victory Island ground in Pokemon DS Map Studio. Run from Git Bash; everything is written under C:/Projects/hub-work/dsms.
#   sh tools/hub/dsms/dsms.sh export     write victory-island/export/VictoryIsland.obj (+ .mtl, textures) for the hub
#   sh tools/hub/dsms/dsms.sh preview    render victory-island/preview.png (top-down, all maps)
#   sh tools/hub/dsms/dsms.sh sheets     render labelled sheets of every tile into tile-sheets/
#   sh tools/hub/dsms/dsms.sh generate [--force]   rebuild VictoryIsland.pdsmap and .per files from victory-mc.json (minecraft-layout.js)
#   sh tools/hub/dsms/dsms.sh rebuild    re-read the Minecraft build and redo map, buildings, world.json and export
#   sh tools/hub/dsms/dsms.sh pokeathlon add the Pokeathlon track tiles and glass archway to the map's tileset (once)
#   sh tools/hub/dsms/dsms.sh props      add the Poke Ball plaza, Pokeathlon bench, flower bed, light and sign, and the signpost (once each)
# generate and rebuild overwrite hand edits in the map; generate refuses when the map exists unless --force is given.
# rebuild reads a copy of MC_WORLD (a Bedrock world folder) over the area MC_AREA ("x0 z0 x1 z1").
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${DSMS_WORK:-C:/Projects/hub-work/dsms}
LIB=${DSMS_LIB:-$WORK/app/Pokemon DS Map Studio-2.2/lib}
JAVA_HOME=${JAVA_HOME:-C:/Program Files/Microsoft/jdk-17.0.20.101-hotspot}
MAP=$WORK/victory-island
REPO=$(cd "$HERE/../../.." && pwd)
MC_WORLD=${MC_WORLD:-$APPDATA/Minecraft Bedrock/Users/15186506106130699676/games/com.mojang/minecraftWorlds/KPNGuozZ89M=}
MC_AREA=${MC_AREA:--200 -175 -107 -80}
NAME=VictoryIsland
SEP=';'; case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) ;; *) SEP=':';; esac
CP="$LIB/Pokemon DS Map Studio-2.2.jar${SEP}$LIB/jogamp-fat.jar${SEP}$LIB/graphicslib3D.jar"
BUILD=$WORK/tools-build

mkdir -p "$BUILD"
"$JAVA_HOME/bin/javac" -nowarn -cp "$CP" -d "$BUILD" "$HERE"/*.java
# the tileset the map names (saving in DS Map Studio writes its own copy, VictoryIsland.pdsts, and points the map at it)
map_tileset() { if [ -f "$MAP/$NAME.pdsmap" ]; then sed -n '/^tileset/{n;p;q;}' "$MAP/$NAME.pdsmap" | tr -d '\r'; else echo JourneysHub.pdsts; fi; }
run() { "$JAVA_HOME/bin/java" -Djava.awt.headless=true -cp "$CP${SEP}$BUILD" "$@" | grep -v '^Numero de tiles' || true; }

case "$1" in
  export)
    mkdir -p "$MAP/export"
    node "$HERE/deck-collisions.js" "$MAP" "$NAME" # planks placed by hand stand as bridges in the hub
    run ExportObj "$MAP/$NAME.pdsmap" "$MAP/export/$NAME" ;;
  preview)
    run MapPreview "$MAP/$(map_tileset)" "$MAP/$NAME.pdsmap" "$MAP/preview.png" 12 ;;
  sheets)
    mkdir -p "$WORK/tile-sheets"
    for r in "0 171" "172 433" "434 657" "658 878" "879 1080" "1081 1268" "1269 1450" "1451 1637"; do
      # shellcheck disable=SC2086
      run TileAtlas "$WORK/hub-tileset/JourneysHub.pdsts" "$WORK/tile-sheets/tiles" $r
    done ;;
  generate)
    if [ -f "$MAP/$NAME.pdsmap" ] && [ "$2" != "--force" ]; then
      echo "$MAP/$NAME.pdsmap exists and may hold hand edits; use generate --force to replace it." >&2; exit 1
    fi
    mkdir -p "$MAP"
    [ -f "$MAP/JourneysHub.pdsts" ] || cp "$WORK/hub-tileset/"*.png "$WORK/hub-tileset/JourneysHub.pdsts" "$MAP/"
    [ -f "$WORK/tile-sig.json" ] || run TileSig "$WORK/hub-tileset/JourneysHub.pdsts" "$WORK/tile-sig.json" 0 1637
    [ -s "$WORK/tile-z.json" ] || run TileZ "$WORK/hub-tileset/JourneysHub.pdsts" 0 1637 > "$WORK/tile-z.json"
    node "$HERE/victory-map.js" "$WORK/victory-mc.json" "$MAP" "$WORK/tile-sig.json" "$WORK/tile-z.json" | tail -1 ;;
  rebuild)
    rm -rf "$WORK/mcworld" && mkdir -p "$WORK/mcworld" && cp -r "$MC_WORLD/db" "$WORK/mcworld/"
    # shellcheck disable=SC2086
    node "$HERE/minecraft-layout.js" "$WORK/mcworld/db" $MC_AREA "$WORK/victory-mc.json" 1 | grep -E '^(stairs|walls|[0-9]+x)'
    [ -f "$MAP/JourneysHub.pdsts" ] || cp "$WORK/hub-tileset/"*.png "$WORK/hub-tileset/JourneysHub.pdsts" "$MAP/"
    # buildings stand on grass (no paved aprons); victory-map.js still accepts an aprons file if one is wanted
    node "$HERE/victory-map.js" "$WORK/victory-mc.json" "$MAP" "$WORK/tile-sig.json" "$WORK/tile-z.json" | sed -n '/problems/,$p'
    node "$HERE/victory-world.js" "$WORK/../world.before-victory.json" "$WORK/victory-mc.json" "$MAP/tiles.json" "$REPO/hub/game/config/world.json" "$MAP" | grep -E 'filler|route|Error'
    run ExportObj "$MAP/$NAME.pdsmap" "$MAP/export/$NAME" ;;
  pokeathlon)
    # HeartGold Pokeathlon pieces converted with convert-models.ps1 into PK_GLB (poke_c_obj, plus tex/pk_track.png
    # exported with apicula --more-textures); appended to the map's tileset once, indices added to model-tile-index.txt
    PK=${PK_GLB:-C:/Projects/hub-work/pokeathlon-glb}
    if grep -q 'track_1111.obj' "$MAP/model-tile-index.txt"; then echo "Pokeathlon tiles already in the tileset"; exit 0; fi
    run TrackTiles "$PK/tex/pk_track.png" "$WORK/track-tiles"
    node -e "const [lib, glb, dir, list] = process.argv.slice(1), r = require(lib).convert(glb, dir, 'poke_c_obj', 1, 20);
      require('fs').appendFileSync(list, [dir, 'poke_c_obj.obj', r.w, r.h].join(String.fromCharCode(9)) + String.fromCharCode(10));" \
      "$HERE/glb-to-obj.js" "$PK/poke_c_obj/poke_c_obj.glb" "$WORK/model-tiles/poke_c_obj" "$WORK/track-tiles/import-list.txt"
    TS=$(map_tileset); cp "$MAP/$TS" "$MAP/$TS.before-pokeathlon"
    run TileImport "$MAP/$TS" "$MAP/$TS" "$WORK/track-tiles/import-list.txt" | tee /dev/stderr | grep -E '^[0-9]+[[:space:]]' >> "$MAP/model-tile-index.txt" ;;
  props)
    # the Poke Ball plaza and HeartGold props (Pokeathlon bench, flower bed, light, sign; the wooden signpost board_a),
    # each added once to the map's tileset and to JourneysHub.pdsts alike, so both keep the same tile numbers
    PK=${PK_GLB:-C:/Projects/hub-work/pokeathlon-glb}
    LIST="$WORK/track-tiles/props-list.txt"; : > "$LIST"
    has() { grep -q "	$1.obj	" "$MAP/model-tile-index.txt"; }
    has pokeball_plaza || run PlazaTile "$PK/tex/pk_track.png" "$WORK/track-tiles" 13 >> "$LIST"
    for n in poke_c_bench poke_c_flower poke_c_light poke_c_mon board_a; do
      has "$n" && continue
      node -e "const [lib, glb, dir, name, list] = process.argv.slice(1), r = require(lib).convert(glb, dir, name, 1, 20);
        require('fs').appendFileSync(list, [dir, name + '.obj', r.w, r.h].join(String.fromCharCode(9)) + String.fromCharCode(10));" \
        "$HERE/glb-to-obj.js" "$PK/$n/$n.glb" "$WORK/model-tiles/$n" "$n" "$LIST"
    done
    if [ ! -s "$LIST" ]; then echo "props already in the tileset"; exit 0; fi
    TS=$(map_tileset)
    for ts in $(printf '%s\n' "$TS" JourneysHub.pdsts | sort -u); do
      cp "$MAP/$ts" "$MAP/$ts.before-props"
      run TileImport "$MAP/$ts" "$MAP/$ts" "$LIST" > "$WORK/track-tiles/props-index-$ts.txt"
    done
    tee /dev/stderr < "$WORK/track-tiles/props-index-$TS.txt" | grep -E '^[0-9]+[[:space:]]' >> "$MAP/model-tile-index.txt" ;;
  *)
    sed -n '2,13p' "$0"; exit 2 ;;
esac
