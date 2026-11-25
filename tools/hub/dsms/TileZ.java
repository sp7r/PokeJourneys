import tileset.*;
import java.util.*;
/** Corner and centre heights of each tile's top surface (max z of faces over a point), in tile units.
 *  Points per cell: NW NE SW SE C (x,y in tile units, y north). Args: tileset from to */
public class TileZ {
    public static void main(String[] a) throws Exception {
        Tileset t = TilesetIO.readTilesetFromFile(a[0]);
        StringBuilder sb = new StringBuilder("{\n"); boolean first = true;
        for (int i = Integer.parseInt(a[1]); i <= Integer.parseInt(a[2]); i++) {
            Tile tile = t.get(i); ArrayList<Float> v = tile.getVertexCoordsObj();
            List<Face> all = new ArrayList<>(); if (tile.getFIndQuadObj()!=null) all.addAll(tile.getFIndQuadObj()); if (tile.getFIndTriObj()!=null) all.addAll(tile.getFIndTriObj());
            StringBuilder cells = new StringBuilder();
            for (int cy = tile.getHeight() - 1; cy >= 0; cy--) for (int cx = 0; cx < tile.getWidth(); cx++) {
                double[][] pts = {{cx+.08, cy+.92},{cx+.92, cy+.92},{cx+.08, cy+.08},{cx+.92, cy+.08},{cx+.5, cy+.5}};
                StringBuilder c = new StringBuilder();
                for (double[] p : pts) {
                    double best = Double.NaN;
                    for (Face f : all) for (int k = 1; k + 1 < f.vInd.length; k++) {
                        int[] id = {f.vInd[0]-1, f.vInd[k]-1, f.vInd[k+1]-1};
                        double x0=v.get(id[0]*3),y0=v.get(id[0]*3+1),x1=v.get(id[1]*3),y1=v.get(id[1]*3+1),x2=v.get(id[2]*3),y2=v.get(id[2]*3+1);
                        double d=(y1-y2)*(x0-x2)+(x2-x1)*(y0-y2); if (Math.abs(d)<1e-9) continue;
                        double l0=((y1-y2)*(p[0]-x2)+(x2-x1)*(p[1]-y2))/d, l1=((y2-y0)*(p[0]-x2)+(x0-x2)*(p[1]-y2))/d, l2=1-l0-l1;
                        if (l0<-1e-4||l1<-1e-4||l2<-1e-4) continue;
                        double z=l0*v.get(id[0]*3+2)+l1*v.get(id[1]*3+2)+l2*v.get(id[2]*3+2);
                        if (Double.isNaN(best)||z>best) best=z;
                    }
                    if (c.length()>0) c.append(',');
                    c.append(Double.isNaN(best)?"null":String.format(Locale.ROOT,"%.2f",best));
                }
                if (cells.length()>0) cells.append(',');
                cells.append('[').append(c).append(']');
            }
            sb.append(first?"":",\n").append('"').append(i).append("\":{\"w\":").append(tile.getWidth()).append(",\"h\":").append(tile.getHeight()).append(",\"name\":\"").append(tile.getObjFilename()).append("\",\"z\":[").append(cells).append("]}");
            first=false;
        }
        System.out.println(sb.append("\n}"));
    }
}
