import tileset.*;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.*;
import java.util.*;
import javax.imageio.ImageIO;

/** Renders layer 0..7 of a .pdsmap top-down (tile rows are stored bottom-up within each map). Args: tileset.pdsts map.pdsmap out.png pxPerCell */
public class MapPreview {
    public static void main(String[] a) throws Exception {
        Tileset t = TilesetIO.readTilesetFromFile(a[0]);
        int px = Integer.parseInt(a[3]);
        java.util.List<String> lines = java.nio.file.Files.readAllLines(new File(a[1]).toPath());
        Map<String, int[][][]> maps = new LinkedHashMap<>();
        int maxX = 0, maxY = 0;
        for (int i = 0; i < lines.size(); i++) {
            if (!lines.get(i).equals("mapstart")) continue;
            String[] p = lines.get(i + 1).trim().split(" ");
            int mx = Integer.parseInt(p[0]), my = Integer.parseInt(p[1]);
            maxX = Math.max(maxX, mx); maxY = Math.max(maxY, my);
            int[][][] g = new int[8][32][32];
            int k = i + 2, layer = 0;
            while (layer < 8) {
                if (lines.get(k).equals("tilegrid")) {
                    for (int y = 0; y < 32; y++) { String[] v = lines.get(k + 1 + y).trim().split(" "); for (int x = 0; x < 32; x++) g[layer][x][y] = Integer.parseInt(v[x]); }
                    layer++; k += 33;
                } else k++;
            }
            maps.put(mx + "," + my, g);
        }
        BufferedImage img = new BufferedImage((maxX + 1) * 32 * px, (maxY + 1) * 32 * px, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = img.createGraphics();
        g.setColor(Color.BLACK); g.fillRect(0, 0, img.getWidth(), img.getHeight());
        for (int layer = 0; layer < 8; layer++)
            for (Map.Entry<String, int[][][]> e : maps.entrySet()) {
                String[] p = e.getKey().split(",");
                int ox = Integer.parseInt(p[0]) * 32, oy = Integer.parseInt(p[1]) * 32;
                for (int y = 0; y < 32; y++) for (int x = 0; x < 32; x++) {
                    int id = e.getValue()[layer][x][y];
                    if (id < 0) continue;
                    Tile tile = t.get(id);
                    // tile local origin is its south-west corner; it spans width east and height north
                    TileAtlas.draw(g, t, tile, (ox + x) * px, (oy + 31 - y + 1 - tile.getHeight()) * px, px);
                }
            }
        ImageIO.write(img, "png", new File(a[2]));
    }
}
