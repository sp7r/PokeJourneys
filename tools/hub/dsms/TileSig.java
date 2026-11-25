import tileset.*;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.File;
import java.util.*;

/** Writes per-region average colours (3x3: NW N NE / W C E / SW S SE) of each 1x1 tile rendered top-down. Args: tileset.pdsts out.json from to */
public class TileSig {
    public static void main(String[] a) throws Exception {
        Tileset t = TilesetIO.readTilesetFromFile(a[0]);
        int from = Integer.parseInt(a[2]), to = Integer.parseInt(a[3]), S = 32;
        StringBuilder sb = new StringBuilder("{\n");
        boolean first = true;
        for (int i = from; i <= to; i++) {
            Tile tile = t.get(i);
            if (tile.getWidth() != 1 || tile.getHeight() != 1) continue;
            BufferedImage img = new BufferedImage(S, S, BufferedImage.TYPE_INT_ARGB);
            Graphics2D g = img.createGraphics();
            TileAtlas.draw(g, t, tile, 0, 0, S);
            g.dispose();
            // region boxes: border strips 2..6 px, centre 12..20
            int[][] xs = {{1, 6}, {12, 20}, {26, 31}};
            StringBuilder r = new StringBuilder();
            for (int ry = 0; ry < 3; ry++) for (int rx = 0; rx < 3; rx++) {
                long R = 0, G = 0, B = 0, A = 0, n = 0;
                for (int y = xs[ry][0]; y < xs[ry][1]; y++) for (int x = xs[rx][0]; x < xs[rx][1]; x++) {
                    int p = img.getRGB(x, y); n++;
                    if ((p >>> 24) < 128) continue;
                    A++; R += (p >> 16) & 255; G += (p >> 8) & 255; B += p & 255;
                }
                if (r.length() > 0) r.append(',');
                if (A * 2 < n) r.append("null"); else r.append('[').append(R / A).append(',').append(G / A).append(',').append(B / A).append(']');
            }
            sb.append(first ? "" : ",\n").append('"').append(i).append("\":{\"name\":\"").append(tile.getObjFilename()).append("\",\"r\":[").append(r).append("]}");
            first = false;
        }
        sb.append("\n}\n");
        java.nio.file.Files.writeString(new File(a[1]).toPath(), sb);
    }
}
