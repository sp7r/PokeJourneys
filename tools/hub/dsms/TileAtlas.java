import tileset.*;
import editor.smartdrawing.SmartGrid;
import java.awt.*;
import java.awt.geom.*;
import java.awt.image.BufferedImage;
import java.io.File;
import java.util.*;
import javax.imageio.ImageIO;

/** Renders DS Map Studio tiles top-down into labelled sheets. Args: tileset.pdsts outPrefix [from to] */
public class TileAtlas {
    public static void main(String[] a) throws Exception {
        Tileset t = TilesetIO.readTilesetFromFile(a[0]);
        int from = a.length > 2 ? Integer.parseInt(a[2]) : 0, to = a.length > 3 ? Integer.parseInt(a[3]) : t.size() - 1;
        int cols = 12, cell = 96, lab = 24;
        int n = to - from + 1;
        BufferedImage out = new BufferedImage(cols * cell, ((n + cols - 1) / cols) * (cell + lab), BufferedImage.TYPE_INT_RGB);
        Graphics2D g = out.createGraphics();
        g.setColor(new Color(255, 0, 255)); g.fillRect(0, 0, out.getWidth(), out.getHeight());
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_NEAREST_NEIGHBOR);
        for (int i = from; i <= to; i++) {
            Tile tile = t.get(i);
            int k = i - from, x0 = (k % cols) * cell, y0 = (k / cols) * (cell + lab);
            g.setColor(new Color(60, 60, 70)); g.fillRect(x0 + 1, y0 + 1, cell - 2, cell - 2);
            int span = Math.max(tile.getWidth(), tile.getHeight());
            float ppu = (cell - 8) / (float) span;
            Shape oldClip = g.getClip();
            g.setClip(x0 + 1, y0 + 1, cell - 2, cell - 2);
            draw(g, t, tile, x0 + 4, y0 + 4, ppu);
            g.setClip(oldClip);
            g.setTransform(new AffineTransform());
            g.setColor(Color.YELLOW); g.setFont(new Font("Arial", Font.BOLD, 11));
            g.drawString(i + "  " + tile.getWidth() + "x" + tile.getHeight(), x0 + 2, y0 + cell + 10);
            g.setColor(Color.WHITE); g.setFont(new Font("Arial", Font.PLAIN, 9));
            String nm = tile.getObjFilename().replace(".obj", "");
            g.drawString(nm.length() > 18 ? nm.substring(0, 18) : nm, x0 + 2, y0 + cell + 21);
        }
        ImageIO.write(out, "png", new File(a[1] + "_" + from + "-" + to + ".png"));
        if (from == 0) {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < t.size(); i++) {
                Tile tile = t.get(i);
                float[] mn = {1e9f,1e9f,1e9f}, mx = {-1e9f,-1e9f,-1e9f};
                ArrayList<Float> v = tile.getVertexCoordsObj();
                for (int j = 0; j < v.size(); j += 3) for (int c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], v.get(j+c)); mx[c] = Math.max(mx[c], v.get(j+c)); }
                sb.append(String.format(Locale.ROOT, "%d\t%dx%d\t%s\tx%.2f..%.2f y%.2f..%.2f z%.2f..%.2f\toff %.2f %.2f\ttex %s%n", i, tile.getWidth(), tile.getHeight(), tile.getObjFilename(), mn[0], mx[0], mn[1], mx[1], mn[2], mx[2], tile.getXOffset(), tile.getYOffset(), names(t, tile)));
            }
            java.nio.file.Files.writeString(new File(a[1] + "_tiles.txt").toPath(), sb);
            StringBuilder sg = new StringBuilder();
            for (SmartGrid s : t.getSmartGridArray()) { for (int[] r : s.sgrid) sg.append(Arrays.toString(r)); sg.append('\n'); }
            java.nio.file.Files.writeString(new File(a[1] + "_smart.txt").toPath(), sg);
        }
    }
    static String names(Tileset t, Tile tile) {
        StringBuilder s = new StringBuilder();
        for (int id : tile.getTextureIDs()) s.append(t.getImageName(id)).append(',');
        return s.toString();
    }
    static void draw(Graphics2D g, Tileset t, Tile tile, int ox, int oy, float ppu) {
        ArrayList<Float> v = tile.getVertexCoordsObj(), tc = tile.getTextureCoordsObj();
        java.util.List<Object[]> faces = new ArrayList<>();
        collect(faces, tile.getFIndQuadObj(), tile.getTexOffsetsQuad(), tile.getTextureIDs());
        collect(faces, tile.getFIndTriObj(), tile.getTexOffsetsTri(), tile.getTextureIDs());
        float minX = 1e9f, maxY = -1e9f;
        for (int j = 0; j < v.size(); j += 3) { minX = Math.min(minX, v.get(j)); maxY = Math.max(maxY, v.get(j + 1)); }
        // tile origin: cell grid starts at x=0,y=0 (bottom-left) going up; screen y down
        final float bx = 0, by = tile.getHeight();
        faces.sort(Comparator.comparingDouble(f -> { Face fc = (Face) f[0]; double z = 0; for (int vi : fc.vInd) z += v.get((vi - 1) * 3 + 2); return z / fc.vInd.length; }));
        for (Object[] f : faces) {
            Face fc = (Face) f[0]; int texId = (Integer) f[1];
            BufferedImage img = t.getTextureImg(texId);
            if (img == null) continue;
            int w = img.getWidth(), h = img.getHeight();
            for (int k = 1; k + 1 < fc.vInd.length; k++) {
                int[] ids = {0, k, k + 1};
                double[] sx = new double[3], sy = new double[3], tx = new double[3], ty = new double[3];
                for (int m = 0; m < 3; m++) {
                    int vi = fc.vInd[ids[m]] - 1, ti = fc.tInd[ids[m]] - 1;
                    sx[m] = ox + (v.get(vi * 3) - bx) * ppu; sy[m] = oy + (by - v.get(vi * 3 + 1)) * ppu;
                    tx[m] = tc.get(ti * 2) * w; ty[m] = (1 - tc.get(ti * 2 + 1)) * h;
                }
                AffineTransform A = affine(tx, ty, sx, sy);
                if (A == null) continue;
                Graphics2D gg = (Graphics2D) g.create();
                gg.transform(A);
                gg.setPaint(new TexturePaint(img, new Rectangle2D.Double(0, 0, w, h)));
                Path2D p = new Path2D.Double(); p.moveTo(tx[0], ty[0]); p.lineTo(tx[1], ty[1]); p.lineTo(tx[2], ty[2]); p.closePath();
                gg.fill(p); gg.dispose();
            }
        }
    }
    static void collect(java.util.List<Object[]> out, ArrayList<Face> faces, ArrayList<Integer> offs, ArrayList<Integer> ids) {
        if (faces == null) return;
        for (int i = 0; i < faces.size(); i++) {
            int t = 0;
            for (int k = 0; k < offs.size(); k++) if (i >= offs.get(k)) t = k;
            out.add(new Object[]{faces.get(i), ids.get(t)});
        }
    }
    static AffineTransform affine(double[] tx, double[] ty, double[] sx, double[] sy) {
        double d = (tx[1]-tx[0])*(ty[2]-ty[0]) - (tx[2]-tx[0])*(ty[1]-ty[0]);
        double ds = (sx[1]-sx[0])*(sy[2]-sy[0]) - (sx[2]-sx[0])*(sy[1]-sy[0]);
        if (Math.abs(d) < 1e-9 || Math.abs(ds) < 0.5) return null;
        double a = ((sx[1]-sx[0])*(ty[2]-ty[0]) - (sx[2]-sx[0])*(ty[1]-ty[0])) / d;
        double b = ((tx[1]-tx[0])*(sx[2]-sx[0]) - (tx[2]-tx[0])*(sx[1]-sx[0])) / d;
        double c = ((sy[1]-sy[0])*(ty[2]-ty[0]) - (sy[2]-sy[0])*(ty[1]-ty[0])) / d;
        double e = ((tx[1]-tx[0])*(sy[2]-sy[0]) - (tx[2]-tx[0])*(sy[1]-sy[0])) / d;
        return new AffineTransform(a, c, b, e, sx[0] - a*tx[0] - b*ty[0], sy[0] - c*tx[0] - e*ty[0]);
    }
}
