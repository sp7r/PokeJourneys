import tileset.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.awt.image.BufferedImage;
import java.security.MessageDigest;
import javax.imageio.ImageIO;
public class InspectTiles {
 static String q(String s){return "\""+s.replace("\\","/").replace("\"","\\\"")+"\"";}
 static String hash(BufferedImage b)throws Exception {MessageDigest d=MessageDigest.getInstance("SHA-256");for(int y=0;y<b.getHeight();y++)for(int x=0;x<b.getWidth();x++){int v=b.getRGB(x,y);for(int k=0;k<4;k++)d.update((byte)(v>>>(k*8)));}return HexFormat.of().formatHex(d.digest());}
 public static void main(String[] a)throws Exception{
  Tileset ts=TilesetIO.readTilesetFromFile(a[0]);
  Map<Integer,String> cache=new HashMap<>();
  StringBuilder s=new StringBuilder("{\"tiles\":[");
  for(int i=0;i<ts.size();i++){Tile t=ts.get(i);if(i>0)s.append(',');s.append("{\"id\":").append(i).append(",\"name\":").append(q(t.getObjFilename())).append(",\"width\":").append(t.getWidth()).append(",\"height\":").append(t.getHeight()).append(",\"offset\":[").append(t.getXOffset()).append(',').append(t.getYOffset()).append("],\"textures\":[");boolean first=true;for(int id:t.getTextureIDs()){if(!first)s.append(',');first=false;s.append("{\"name\":").append(q(ts.getImageName(id))).append(",\"hash\":").append(q(cache.computeIfAbsent(id, key -> {try{return hash(ts.getTextureImg(key));}catch(Exception e){throw new RuntimeException(e);}}))).append('}');}s.append("],\"bounds\":[");for(int k=0;k<3;k++){float lo=Float.POSITIVE_INFINITY,hi=Float.NEGATIVE_INFINITY;ArrayList<Float> v=t.getVertexCoordsObj();for(int j=k;j<v.size();j+=3){lo=Math.min(lo,v.get(j));hi=Math.max(hi,v.get(j));}if(k>0)s.append(',');s.append('[').append(Float.isFinite(lo)?lo:0).append(',').append(Float.isFinite(hi)?hi:0).append(']');}s.append("]}");}
  s.append("],\"reference\":{");boolean first=true;for(File f:new File(a[2]).listFiles()){if(!f.getName().matches("(terrain|buildings|decorations)-\\d+\\.png"))continue;if(!first)s.append(',');first=false;s.append(q(f.getName())).append(':').append(q(hash(ImageIO.read(f))));}s.append("}}");Files.writeString(Path.of(a[1]),s);System.exit(0);
 }
}
