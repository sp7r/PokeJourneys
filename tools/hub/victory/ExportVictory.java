import tileset.*;
import editor.grid.MapGrid;
import formats.obj.ObjWriter;
import java.awt.Point;
import java.io.*;
import java.nio.file.*;
import java.util.*;

/** Uses the existing exporter grid conventions and DS Map Studio's native OBJ writer. */
public class ExportVictory {
 public static void main(String[] a)throws Exception {
  File map=new File(a[0]);
  List<String> lines=Files.readAllLines(map.toPath());
  int game=Integer.parseInt(lines.get(lines.indexOf("gameindex")+1).trim());
  if(game!=2)throw new IllegalArgumentException("Expected gameindex 2");
  Tileset ts=TilesetIO.readTilesetFromFile(new File(map.getParentFile(),lines.get(lines.indexOf("tileset")+1).trim()).getPath());
  Map<Integer,String> groups=new HashMap<>();
  for(String s:Files.readAllLines(Path.of(a[2]))){String[] p=s.split("\\t");groups.put(Integer.parseInt(p[0]),p[1]);}
  HashMap<Point,MapGrid> maps=new HashMap<>();
  for(int i=0;i<lines.size();i++){
   if(!lines.get(i).equals("mapstart"))continue;
   String[] p=lines.get(i+1).trim().split("\\s+");MapGrid g=new MapGrid(null);
   int k=i+2,tl=0,hl=0;
   while(!lines.get(k).equals("mapend")){
    String s=lines.get(k);
    if(s.equals("tilegrid")||s.equals("heightgrid")){
     int[][] m=s.equals("tilegrid")?g.tileLayers[tl++]:g.heightLayers[hl++];
     for(int y=0;y<32;y++){String[] v=lines.get(k+1+y).trim().split("\\s+");for(int x=0;x<32;x++)m[x][y]=Integer.parseInt(v[x]);}k+=33;
    }else k++;
   }
   maps.put(new Point(Integer.parseInt(p[0]),Integer.parseInt(p[1])),g);
  }
  ExportObj.writeCells(new File(a[3]),maps,ts);
  // Cells listed in the deck file ("level mapX mapY layer x y") go to the "deck" (level 1) or "deck2" mesh only.
  Map<String,String> deck=new HashMap<>();
  if(a.length>4)for(String s:Files.readAllLines(Path.of(a[4])))if(!s.isBlank()){String t=s.trim();int sp=t.indexOf(' ');deck.put(t.substring(sp+1),t.substring(0,sp).equals("1")?"deck":"deck2");}
  for(String group:new String[]{"terrain","buildings","decorations","deck","deck2"}){
   HashMap<Point,MapGrid> selected=new HashMap<>();
   for(Map.Entry<Point,MapGrid> entry:maps.entrySet()){
    MapGrid src=entry.getValue(),dst=new MapGrid(null);
    for(int k=0;k<MapGrid.numLayers;k++)for(int x=0;x<32;x++)for(int y=0;y<32;y++){
     int id=src.tileLayers[k][x][y];
     String level=deck.get(entry.getKey().x+" "+entry.getKey().y+" "+k+" "+x+" "+y);
     dst.tileLayers[k][x][y]=id>=0&&(group.startsWith("deck")?group.equals(level):level==null&&group.equals(groups.get(id)))?id:-1;
     dst.heightLayers[k][x][y]=src.heightLayers[k][x][y];
    }
    selected.put(entry.getKey(),dst);
   }
   File dir=new File(a[1],group);dir.mkdirs();
   ObjWriter writer=new ObjWriter(ts,selected,new File(dir,group+".obj").getPath(),game,true,false,1.0f);
   writer.writeMapObj();writer.writeTextures();
   System.out.println("Exported "+group+" at native 1:1 size");
  }
  System.exit(0);
 }
}
