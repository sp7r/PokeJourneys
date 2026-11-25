import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.File;
import java.nio.file.*;
import java.util.*;

/**
 * Writes Pokeathlon track overlay tiles for DS Map Studio: one 1x1 OBJ tile per corner pattern (NW, NE, SW, SE),
 * orange track where a corner is track, a white rim along every edge with plain ground, transparent elsewhere, laid
 * just above the ground so the ground tile underneath shows through.
 * Args: track.png (the HeartGold pk_track texture) outDir ; writes outDir/track_XXXX/ and outDir/import-list.txt.
 */
public class TrackTiles {
    public static void main(String[] a) throws Exception {
        BufferedImage src = ImageIO.read(new File(a[0]));
        Path out = Paths.get(a[1]);
        StringBuilder list = new StringBuilder();
        int white = 0xFFF8F8F8;
        for (int key = 1; key < 16; key++) {
            boolean[] on = { (key & 8) != 0, (key & 4) != 0, (key & 2) != 0, (key & 1) != 0 }; // NW NE SW SE
            String name = "track_" + (on[0] ? 1 : 0) + (on[1] ? 1 : 0) + (on[2] ? 1 : 0) + (on[3] ? 1 : 0);
            BufferedImage img = new BufferedImage(16, 16, BufferedImage.TYPE_INT_ARGB);
            for (int py = 0; py < 16; py++) for (int px = 0; px < 16; px++) {
                int qx = px < 8 ? 0 : 1, qy = py < 8 ? 0 : 1, q = qy * 2 + qx;
                if (!on[q]) continue;
                boolean rimX = !on[qy * 2 + (1 - qx)] && (qx == 0 ? px >= 6 : px <= 9);
                boolean rimY = !on[(1 - qy) * 2 + qx] && (qy == 0 ? py >= 6 : py <= 9);
                // the inside corner where only the diagonal quadrant is plain ground
                boolean rimD = !on[(1 - qy) * 2 + (1 - qx)] && (qx == 0 ? px >= 6 : px <= 9) && (qy == 0 ? py >= 6 : py <= 9);
                img.setRGB(px, py, rimX || rimY || rimD ? white : (0xFF000000 | src.getRGB(px % src.getWidth(), py % src.getHeight())));
            }
            Path dir = out.resolve(name);
            Files.createDirectories(dir);
            ImageIO.write(img, "png", dir.resolve(name + ".png").toFile());
            Files.writeString(dir.resolve(name + ".mtl"), "newmtl " + name + "\nmap_Kd " + name + ".png\nmap_d " + name + ".png\n");
            float z = 0.02f;
            Files.writeString(dir.resolve(name + ".obj"), "mtllib " + name + ".mtl\no " + name + "\n"
                + "v 0 0 " + z + "\nv 1 0 " + z + "\nv 1 1 " + z + "\nv 0 1 " + z + "\n"
                + "vt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\nvn 0 0 1\nusemtl " + name + "\nf 1/1/1 2/2/1 3/3/1\nf 1/1/1 3/3/1 4/4/1\n");
            list.append(dir.toString().replace('\\', '/')).append('\t').append(name).append(".obj\t1\t1\n");
        }
        Files.writeString(out.resolve("import-list.txt"), list.toString());
        System.out.println("track tiles 15");
    }
}
