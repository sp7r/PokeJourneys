import tileset.*;
import editor.grid.MapGrid;
import formats.obj.ObjWriter;
import java.awt.Point;
import java.io.File;
import java.io.PrintWriter;
import java.util.*;

/**
 * Exports every map of a .pdsmap into one OBJ+MTL (+ textures) with DS Map Studio's own ObjWriter.
 * Args: map.pdsmap out.obj [skip] [cells.json]
 *   skip        tile ids left out of the export, e.g. "1638-1739,1755,1757-1761" (buildings placed as separate models)
 *   cells.json  also write the top tile id and its height for every cell, rows north first, over the whole map matrix
 */
public class ExportObj {
    public static void main(String[] a) throws Exception {
        File map = new File(a[0]);
        Set<Integer> skip = a.length > 2 ? parseSkip(a[2]) : Collections.emptySet();
        List<String> lines = java.nio.file.Files.readAllLines(map.toPath());
        int game = Integer.parseInt(lines.get(lines.indexOf("gameindex") + 1).trim());
        String tsName = lines.get(lines.indexOf("tileset") + 1).trim();
        Tileset t = TilesetIO.readTilesetFromFile(new File(map.getParentFile(), tsName).getPath());
        HashMap<Point, MapGrid> maps = new HashMap<>();
        for (int i = 0; i < lines.size(); i++) {
            if (!lines.get(i).equals("mapstart")) continue;
            String[] p = lines.get(i + 1).trim().split(" ");
            MapGrid g = new MapGrid(null);
            int k = i + 2, tl = 0, hl = 0;
            while (!lines.get(k).equals("mapend")) {
                String s = lines.get(k);
                if (s.equals("tilegrid") || s.equals("heightgrid")) {
                    boolean tiles = s.equals("tilegrid");
                    int[][] m = tiles ? g.tileLayers[tl++] : g.heightLayers[hl++];
                    for (int y = 0; y < 32; y++) {
                        String[] v = lines.get(k + 1 + y).trim().split(" ");
                        for (int x = 0; x < 32; x++) {
                            int id = Integer.parseInt(v[x]);
                            m[x][y] = tiles && skip.contains(id) ? -1 : id;
                        }
                    }
                    k += 33;
                } else k++;
            }
            maps.put(new Point(Integer.parseInt(p[0]), Integer.parseInt(p[1])), g);
        }
        ObjWriter w = new ObjWriter(t, maps, a[1], game, true, false, 1.0f);
        w.writeMapObj();
        w.writeTextures();
        if (a.length > 3) writeCells(new File(a[3]), maps, t);
        System.out.println("exported " + maps.size() + " maps");
    }

    static Set<Integer> parseSkip(String spec) {
        Set<Integer> out = new HashSet<>();
        for (String part : spec.split(",")) {
            if (part.isBlank()) continue;
            String[] r = part.trim().split("-");
            int lo = Integer.parseInt(r[0]), hi = Integer.parseInt(r[r.length - 1]);
            for (int id = lo; id <= hi; id++) out.add(id);
        }
        return out;
    }

    /** The highest tile covering each cell (multi-cell tiles cover their whole footprint; ties go to the upper layer) and its height. */
    static void writeCells(File f, Map<Point, MapGrid> maps, Tileset t) throws Exception {
        int mx = 0, my = 0;
        for (Point p : maps.keySet()) { mx = Math.max(mx, p.x + 1); my = Math.max(my, p.y + 1); }
        int cols = mx * MapGrid.cols, rows = my * MapGrid.rows;
        int[][] tile = new int[rows][cols], height = new int[rows][cols];
        for (int[] r : tile) Arrays.fill(r, -1);
        for (Map.Entry<Point, MapGrid> e : maps.entrySet()) {
            MapGrid g = e.getValue();
            for (int k = 0; k < MapGrid.numLayers; k++) {
                for (int c = 0; c < MapGrid.cols; c++) {
                    for (int r = 0; r < MapGrid.rows; r++) { // r = 0 is the south row of the map
                        int id = g.tileLayers[k][c][r];
                        if (id < 0 || id >= t.size()) continue;
                        Tile tl = t.get(id);
                        int w = tl.isXtileable() ? 1 : tl.getWidth(), h = tl.isYtileable() ? 1 : tl.getHeight();
                        for (int i = 0; i < w && c + i < MapGrid.cols; i++) {
                            for (int j = 0; j < h && r + j < MapGrid.rows; j++) {
                                int x = e.getKey().x * MapGrid.cols + c + i;
                                int y = e.getKey().y * MapGrid.rows + MapGrid.rows - 1 - (r + j);
                                // highest surface wins: bridge decks stand above the piles and sea under them
                                if (tile[y][x] < 0 || g.heightLayers[k][c][r] >= height[y][x]) {
                                    tile[y][x] = id;
                                    height[y][x] = g.heightLayers[k][c][r];
                                }
                            }
                        }
                    }
                }
            }
        }
        try (PrintWriter pw = new PrintWriter(f, "UTF-8")) {
            pw.println("{\"cols\": " + cols + ", \"rows\": " + rows + ",");
            pw.println("\"tiles\": " + rowsJson(tile) + ",");
            pw.println("\"heights\": " + rowsJson(height) + "}");
        }
    }

    static String rowsJson(int[][] m) {
        StringBuilder sb = new StringBuilder("[\n");
        for (int r = 0; r < m.length; r++) sb.append(Arrays.toString(m[r])).append(r + 1 < m.length ? ",\n" : "\n");
        return sb.append("]").toString();
    }
}
