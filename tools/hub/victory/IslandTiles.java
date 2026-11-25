import tileset.*;
import java.nio.file.*;
import java.util.*;

/** Prints the vertex positions of the tileset tiles listed in a file (one tile id per line, more columns ignored). */
public class IslandTiles {
 public static void main(String[] a)throws Exception{
  Tileset ts=TilesetIO.readTilesetFromFile(a[0]);
  TreeSet<Integer> want=new TreeSet<>();for(String s:Files.readAllLines(Path.of(a[1])))if(!s.isBlank())want.add(Integer.parseInt(s.split("\t")[0].trim()));
  StringBuilder s=new StringBuilder("[");boolean first=true;
  for(int i:want){Tile t=ts.get(i);if(!first)s.append(',');first=false;
   s.append("{\"id\":").append(i).append(",\"name\":\"").append(t.getObjFilename()).append("\",\"w\":").append(t.getWidth()).append(",\"h\":").append(t.getHeight())
    .append(",\"tris\":").append(t.getFIndTriObj().size()).append(",\"quads\":").append(t.getFIndQuadObj().size()).append(",\"v\":").append(t.getVertexCoordsObj()).append("}");}
  Files.writeString(Path.of(a[2]),s.append("]"));System.exit(0);}}
