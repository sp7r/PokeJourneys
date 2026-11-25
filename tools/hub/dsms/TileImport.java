import tileset.*;
import java.io.File;
import java.nio.file.*;
import java.util.*;

/**
 * Appends OBJ models as tiles to a DS Map Studio tileset with the editor's own tile loader.
 * Args: in.pdsts out.pdsts list.txt ; list lines: folder objFile width height [replaceIndex] (tab separated).
 * Writes the tileset, its texture PNGs next to it, and prints the new tile indices.
 */
public class TileImport {
    public static void main(String[] a) throws Exception {
        Tileset t = TilesetIO.readTilesetFromFile(a[0]);
        int first = t.size();
        StringBuilder index = new StringBuilder();
        for (String line : Files.readAllLines(Paths.get(a[2]))) {
            if (line.isBlank()) continue;
            String[] p = line.split("\t");
            Tile tile = new Tile(t, p[0], p[1], Integer.parseInt(p[2]), Integer.parseInt(p[3]), false, false, false, false, false, 1f, 0f, 0f);
            t.addTile(tile);
            int at = t.size() - 1;
            if (p.length > 4) { // fifth column: replace the tile at that index (maps that use it keep their placements)
                at = Integer.parseInt(p[4].trim());
                t.swapTiles(at, t.size() - 1);
                t.removeTile(t.size() - 1);
            }
            index.append(at).append('\t').append(p[1]).append('\t').append(p[2]).append('x').append(p[3]).append('\n');
        }
        File out = new File(a[1]);
        TilesetIO.saveTilesetToFile(out.getPath(), t);
        t.saveImagesToFile(out.getAbsoluteFile().getParent());
        System.out.print(index);
        System.out.println("tiles " + first + ".." + (t.size() - 1) + ", materials " + t.getMaterials().size());
    }
}
