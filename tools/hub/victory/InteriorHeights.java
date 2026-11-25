import formats.bdhc.BdhcLoaderHGSS;
import formats.bdhc.Plate;
import java.io.PrintWriter;
import java.util.Locale;

/** Reads Platinum height plates with the installed map editor's reader. */
public class InteriorHeights {
    public static void main(String[] args) throws Exception {
        if (args.length > 2 && args[2].equals("bw2")) {
            formats.collisions.bw.CollisionsBW3D terrain = new formats.collisions.bw.CollisionsBW3D(args[0], editor.game.Game.BLACK2);
            try (PrintWriter out = new PrintWriter(args[1], "UTF-8")) {
                out.print("[");
                for (int y = 0; y < 32; y++) for (int x = 0; x < 32; x++) {
                    if (x + y > 0) out.print(",");
                    out.print("[");
                    float[] corners = terrain.getZCoords(x, y);
                    for (int k = 0; k < 4; k++) out.printf(Locale.ROOT, "%s%.6f", k == 0 ? "" : ",", corners[k]);
                    out.print("]");
                }
                out.println("]");
            }
            return;
        }
        try (PrintWriter out = new PrintWriter(args[1], "UTF-8")) {
            out.print("[");
            boolean first = true;
            for (Plate p : new BdhcLoaderHGSS().loadBdhcFromFile(args[0]).getPlates()) {
                if (!first) out.print(",");
                first = false;
                out.printf(Locale.ROOT, "{\"map\":[0,0],\"x\":%d,\"y\":%d,\"w\":%d,\"h\":%d,\"z\":%.6f,\"type\":%d,\"v\":[", p.x, p.y, p.width, p.height, p.z, p.type);
                float[] v = p.getVertexCoords();
                for (int i = 0; i < v.length; i++) out.printf(Locale.ROOT, "%s%.6f", i == 0 ? "" : ",", v[i]);
                out.print("]}");
            }
            out.println("]");
        }
    }
}

