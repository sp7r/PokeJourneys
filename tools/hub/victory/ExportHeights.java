import formats.bdhc.Bdhc;
import formats.bdhc.BdhcLoaderHGSS;
import formats.bdhc.Plate;
import java.io.File;
import java.io.PrintWriter;
import java.nio.file.Files;
import java.util.List;
import java.util.Locale;

/** Reads height plates with DS Map Studio's gameindex 2 reader. */
public class ExportHeights {
    public static void main(String[] args) throws Exception {
        File map = new File(args[0]);
        List<String> lines = Files.readAllLines(map.toPath());
        int game = Integer.parseInt(lines.get(lines.indexOf("gameindex") + 1).trim());
        if (game != 2) throw new IllegalArgumentException("Expected gameindex 2, got " + game);
        String stem = map.getName().replaceFirst("\\.pdsmap$", "");
        try (PrintWriter out = new PrintWriter(args[1], "UTF-8")) {
            out.print("[");
            boolean first = true;
            for (int i = 0; i < lines.size(); i++) {
                if (!lines.get(i).trim().equals("mapstart")) continue;
                String[] xy = lines.get(i + 1).trim().split("\\s+");
                int x = Integer.parseInt(xy[0]), y = Integer.parseInt(xy[1]);
                File file = new File(map.getParentFile(), String.format("%s_%02d_%02d.bdhc", stem, x, y));
                Bdhc heights = new BdhcLoaderHGSS().loadBdhcFromFile(file.getPath());
                for (Plate p : heights.getPlates()) {
                    if (!first) out.print(",");
                    first = false;
                    out.printf(Locale.ROOT, "{\"map\":[%d,%d],\"x\":%d,\"y\":%d,\"w\":%d,\"h\":%d,\"z\":%.6f,\"type\":%d,\"v\":[", x, y, p.x, p.y, p.width, p.height, p.z, p.type);
                    float[] vertices = p.getVertexCoords();
                    for (int n = 0; n < vertices.length; n++) out.printf(Locale.ROOT, "%s%.6f", n == 0 ? "" : ",", vertices[n]);
                    out.print("]}");
                }
            }
            out.println("]");
        }
    }
}
