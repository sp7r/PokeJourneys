import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.File;
import java.nio.file.*;

/**
 * Writes the Pokeathlon plaza as one round DS Map Studio tile, drawn like a Poke Ball from the HeartGold pk_track
 * texture: an orange disc with a white rim, a white band across the middle and a white-ringed button in the centre;
 * transparent outside the disc, laid just above the ground and the track tiles.
 * Args: track.png outDir diameterTiles ; the tile is 6x6 in the editor with the disc centred on (2.5, 3.5) from its
 * south-west corner, so a disc centred on map tile (cx, cz) goes on cell (cx - 2.5, cz + 2.5) rounded.
 */
public class PlazaTile {
    public static void main(String[] a) throws Exception {
        BufferedImage src = ImageIO.read(new File(a[0]));
        Path dir = Paths.get(a[1]).resolve("pokeball_plaza");
        int d = Integer.parseInt(a[2]), px = 16, size = d * px; // 16 pixels per tile, as the track tiles
        double r = size / 2.0, rim = px * 0.3, band = px * 0.3, button = r * 0.3, ring = px * 0.3;
        int white = 0xFFF8F8F8, shade = 0xFFC86818;
        BufferedImage img = new BufferedImage(size, size, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < size; y++) for (int x = 0; x < size; x++) {
            double dx = x + 0.5 - r, dy = y + 0.5 - r, dist = Math.hypot(dx, dy);
            if (dist > r) continue; // outside: transparent
            int c = 0xFF000000 | src.getRGB(x % src.getWidth(), y % src.getHeight());
            if (dist > r - rim) c = white;                                  // outer rim
            else if (dist > r - rim - 1.5) c = shade;                       // a darker line inside the rim
            else if (dist <= button + ring && dist > button) c = white;     // ring around the button
            else if (dist > button + ring && Math.abs(dy) <= band / 2) c = white; // band across the middle
            img.setRGB(x, y, c);
        }
        Files.createDirectories(dir);
        ImageIO.write(img, "png", dir.resolve("pokeball_plaza.png").toFile());
        Files.writeString(dir.resolve("pokeball_plaza.mtl"), "newmtl pokeball_plaza\nmap_Kd pokeball_plaza.png\nmap_d pokeball_plaza.png\n");
        double cx = 2.5, cy = 3.5, h = d / 2.0, z = 0.04;
        String v = String.format(java.util.Locale.ROOT, "v %.4f %.4f %.2f\nv %.4f %.4f %.2f\nv %.4f %.4f %.2f\nv %.4f %.4f %.2f\n",
            cx - h, cy - h, z, cx + h, cy - h, z, cx + h, cy + h, z, cx - h, cy + h, z);
        Files.writeString(dir.resolve("pokeball_plaza.obj"), "mtllib pokeball_plaza.mtl\no pokeball_plaza\n" + v
            + "vt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\nvn 0 0 1\nusemtl pokeball_plaza\nf 1/1/1 2/2/1 3/3/1\nf 1/1/1 3/3/1 4/4/1\n");
        System.out.println(dir.toString().replace('\\', '/') + "\tpokeball_plaza.obj\t6\t6");
    }
}
