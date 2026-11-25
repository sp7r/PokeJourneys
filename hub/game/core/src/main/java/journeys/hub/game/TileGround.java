package journeys.hub.game;

import com.badlogic.gdx.Gdx;
import com.badlogic.gdx.graphics.*;
import com.badlogic.gdx.graphics.g3d.*;
import com.badlogic.gdx.graphics.g3d.attributes.*;
import com.badlogic.gdx.graphics.g3d.utils.*;
import com.badlogic.gdx.utils.*;
import net.mgsx.gltf.scene3d.attributes.*;
import java.nio.file.*;
import java.util.*;

/**
 * Tile ground made in Pokemon DS Map Studio: the map's OBJ/MTL export (all maps in one file) for looks,
 * and its per-map .per collision files for walking. DS Map Studio units are tiles, z is up and +y is north;
 * map (0,0) spans -16..16 on both axes and map rows grow southward.
 */
final class TileGround implements Disposable {
    private static final int CELLS=32;
    private static final int SEA_BEHAVIOUR=0x15,BRIDGE_BEHAVIOUR=0x73;
    private final float x0,z0,size;
    private final int mapsX,mapsY;
    private final byte[][] collisions;
    private final Map<String,Texture> textures=new HashMap<>();
    private final Map<String,Material> materials=new LinkedHashMap<>();
    private final Map<String,FloatArray> faces=new LinkedHashMap<>(); // per material: x,y,z,u,v triangles in hub units
    final float seaLevel;
    final float[] bounds={Float.MAX_VALUE,Float.MAX_VALUE,-Float.MAX_VALUE,-Float.MAX_VALUE};

    TileGround(JsonValue config,Path data) throws Exception {
        x0=config.getFloat("x");z0=config.getFloat("z");size=config.getFloat("size");
        mapsX=config.get("maps").getInt(0);mapsY=config.get("maps").getInt(1);
        if(size<=0||mapsX<1||mapsY<1)throw new IllegalArgumentException("ground.tiles needs a positive size and map count");
        Path obj=inside(data,data.resolve(config.getString("obj")));
        collisions=new byte[mapsX*mapsY][];
        for(int my=0;my<mapsY;my++)for(int mx=0;mx<mapsX;mx++) {
            Path per=inside(data,data.resolve(String.format(Locale.ROOT,"%s_%02d_%02d.per",config.getString("per"),mx,my)));
            byte[] bytes=Files.readAllBytes(per);
            if(bytes.length!=CELLS*CELLS*2)throw new IllegalArgumentException("Expected a 2-layer (DP/Pt/HGSS) collision file: "+per);
            collisions[my*mapsX+mx]=bytes;
        }
        readObj(obj,data);
        sampleHeights();
        float low=Float.MAX_VALUE;
        for(FloatArray f:faces.values())for(int i=1;i<f.size;i+=5)low=Math.min(low,f.get(i));
        seaLevel=low==Float.MAX_VALUE?0:low;
        for(int z=0;z<mapsY*CELLS;z++)for(int x=0;x<mapsX*CELLS;x++)if(behaviour(x,z)!=SEA_BEHAVIOUR) {
            bounds[0]=Math.min(bounds[0],x0+x*size);bounds[1]=Math.min(bounds[1],z0+z*size);
            bounds[2]=Math.max(bounds[2],x0+(x+1)*size);bounds[3]=Math.max(bounds[3],z0+(z+1)*size);
        }
    }
    private static Path inside(Path data,Path path) throws Exception {
        Path real=path.toRealPath();
        if(!real.startsWith(data))throw new IllegalArgumentException("Tile ground path escapes data directory: "+path);
        return real;
    }
    private void readObj(Path obj,Path data) throws Exception {
        FloatArray v=new FloatArray(),vt=new FloatArray();
        FloatArray current=null;
        for(String line:Files.readAllLines(obj)) {
            String[] p=line.trim().split("\\s+");
            switch(p[0]) {
                case "mtllib": readMtl(obj.resolveSibling(line.trim().substring(7).trim()),data); break;
                case "v": v.add(Float.parseFloat(p[1]));v.add(Float.parseFloat(p[2]));v.add(Float.parseFloat(p[3])); break;
                case "vt": vt.add(Float.parseFloat(p[1]));vt.add(Float.parseFloat(p[2])); break;
                case "usemtl":
                    if(!materials.containsKey(p[1]))throw new IllegalArgumentException("Material missing from MTL: "+p[1]);
                    current=faces.computeIfAbsent(p[1],k->new FloatArray()); break;
                case "f":
                    if(current==null)throw new IllegalArgumentException("Face before usemtl in "+obj);
                    for(int k=2;k+1<p.length;k++)for(int c:new int[]{1,k,k+1}) {
                        String[] idx=p[c].split("/");
                        int vi=(Integer.parseInt(idx[0])-1)*3,ti=(Integer.parseInt(idx[1])-1)*2;
                        current.add(x0+(v.get(vi)+16)*size);current.add(v.get(vi+2)*size);current.add(z0+(16-v.get(vi+1))*size);
                        current.add(vt.get(ti));current.add(1-vt.get(ti+1));
                    }
                    break;
                default: break;
            }
        }
    }
    private void readMtl(Path mtl,Path data) throws Exception {
        String name=null;
        for(String line:Files.readAllLines(inside(data,mtl))) {
            String s=line.trim();
            if(s.startsWith("newmtl "))name=s.substring(7).trim();
            else if(s.startsWith("map_Kd ")&&name!=null) {
                Path image=inside(data,mtl.resolveSibling(s.substring(7).trim()));
                Texture t=textures.get(image.toString());
                if(t==null) {
                    t=new Texture(Gdx.files.absolute(image.toString()));
                    t.setWrap(Texture.TextureWrap.Repeat,Texture.TextureWrap.Repeat);t.setFilter(Texture.TextureFilter.Nearest,Texture.TextureFilter.Nearest);
                    textures.put(image.toString(),t);
                }
                Material m=new Material(PBRTextureAttribute.createBaseColorTexture(t),new PBRFlagAttribute(PBRFlagAttribute.Unlit),IntAttribute.createCullFace(GL20.GL_NONE));
                // cut-out textures (leaves, arches, railings) keep transparent texels as magenta with zero alpha;
                // the alpha test only takes effect on blended materials, as for the generated ground
                m.set(FloatAttribute.createAlphaTest(.5f));
                m.set(new BlendingAttribute(true,1f));
                materials.put(name,m);
            }
        }
    }
    /** Adds the tile mesh to the ground model, one part per material. */
    void build(ModelBuilder builder) {
        for(Map.Entry<String,FloatArray> e:faces.entrySet()) {
            FloatArray f=e.getValue();
            for(int start=0;start<f.size;start+=5*3*6000) { // keep each part well under the 16-bit index limit
                MeshPartBuilder mesh=builder.part("tiles",GL20.GL_TRIANGLES,VertexAttributes.Usage.Position|VertexAttributes.Usage.Normal|VertexAttributes.Usage.TextureCoordinates,materials.get(e.getKey()));
                for(int i=start;i<Math.min(f.size,start+5*3*6000);i+=15)
                    mesh.triangle(vertex(f,i),vertex(f,i+5),vertex(f,i+10));
            }
        }
    }
    private static MeshPartBuilder.VertexInfo vertex(FloatArray f,int i) {
        return new MeshPartBuilder.VertexInfo().setPos(f.get(i),f.get(i+1),f.get(i+2)).setNor(0,1,0).setUV(f.get(i+3),f.get(i+4));
    }
    private float[] heights,tops; // per cell: lowest and highest surface at its NW, NE, SW and SE corners
    /**
     * Samples the floor of the tile mesh near each cell corner, so walking follows terraces, stairs and the sunken sea.
     * Props placed on upper layers (lamps, buildings, trees) stand on the ground, so the lowest surface is the floor;
     * on bridge cells (plank decks over water or sand) the highest broad surface is.
     */
    private void sampleHeights() {
        int cols=mapsX*CELLS,rows=mapsY*CELLS;
        heights=new float[cols*rows*4];Arrays.fill(heights,Float.NaN);
        tops=new float[cols*rows*4];Arrays.fill(tops,Float.NaN);
        float inset=.25f; // a quarter tile in from the edges, clear of stair side walls and deck borders
        for(FloatArray f:faces.values())for(int i=0;i<f.size;i+=15) {
            float ax=f.get(i),az=f.get(i+2),bx=f.get(i+5),bz=f.get(i+7),cx=f.get(i+10),cz=f.get(i+12);
            float d=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);
            if(Math.abs(d)<1e-3f)continue; // vertical faces carry no floor
            boolean broad=Math.abs(d)/2>=.15f*size*size; // deck boards are broad; lamp heads and railing caps are not
            int x0=(int)Math.floor((Math.min(ax,Math.min(bx,cx))-this.x0)/size),x1=(int)Math.floor((Math.max(ax,Math.max(bx,cx))-this.x0)/size);
            int z0=(int)Math.floor((Math.min(az,Math.min(bz,cz))-this.z0)/size),z1=(int)Math.floor((Math.max(az,Math.max(bz,cz))-this.z0)/size);
            for(int gz=Math.max(0,z0);gz<=Math.min(rows-1,z1);gz++)for(int gx=Math.max(0,x0);gx<=Math.min(cols-1,x1);gx++)
                for(int k=0;k<4;k++) {
                    float px=this.x0+(gx+((k&1)==0?inset:1-inset))*size,pz=this.z0+(gz+(k<2?inset:1-inset))*size;
                    float l0=((bz-cz)*(px-cx)+(cx-bx)*(pz-cz))/d,l1=((cz-az)*(px-cx)+(ax-cx)*(pz-cz))/d,l2=1-l0-l1;
                    if(l0<-1e-4f||l1<-1e-4f||l2<-1e-4f)continue;
                    float y=l0*f.get(i+1)+l1*f.get(i+6)+l2*f.get(i+11);
                    int at=(gz*cols+gx)*4+k;
                    if(Float.isNaN(heights[at])||y<heights[at])heights[at]=y;
                    if(broad&&(Float.isNaN(tops[at])||y>tops[at]))tops[at]=y;
                }
        }
        for(int i=0;i<heights.length;i++){if(Float.isNaN(heights[i]))heights[i]=0;if(Float.isNaN(tops[i]))tops[i]=heights[i];}
    }
    /** Ground height under a point, blended across the cell from its corner samples; 0 outside the maps. */
    float height(float x,float z) {
        int i=index(x,z);if(i<0)return seaLevel;
        // samples sit a quarter tile in; the plane through them is extended to the cell edges so slopes meet without a step
        float u=((x-x0)/size-(float)Math.floor((x-x0)/size)-.25f)/.5f;
        float v=((z-z0)/size-(float)Math.floor((z-z0)/size)-.25f)/.5f;
        float[] h=behaviour(i%(mapsX*CELLS),i/(mapsX*CELLS))==BRIDGE_BEHAVIOUR?tops:heights;
        float nw=h[i*4],ne=h[i*4+1],sw=h[i*4+2],se=h[i*4+3];
        return (nw*(1-u)+ne*u)*(1-v)+(sw*(1-u)+se*u)*v;
    }
    private int index(float x,float z) {
        int cx=(int)Math.floor((x-x0)/size),cz=(int)Math.floor((z-z0)/size);
        if(cx<0||cz<0||cx>=mapsX*CELLS||cz>=mapsY*CELLS)return -1;
        return cz*mapsX*CELLS+cx;
    }
    private int behaviour(int cx,int cz){return collisions[(cz/CELLS)*mapsX+cx/CELLS][((cz%CELLS)*CELLS+cx%CELLS)*2]&0xff;}
    /** Not sea: used for coastline walls where piers meet the island. */
    boolean land(float x,float z) {
        int i=index(x,z);if(i<0)return false;
        return behaviour(i%(mapsX*CELLS),i/(mapsX*CELLS))!=SEA_BEHAVIOUR;
    }
    /** Walkable when the cell's collision byte is clear (0x80 blocks). */
    boolean walkable(float x,float z) {
        int i=index(x,z);if(i<0)return false;
        int cx=i%(mapsX*CELLS),cz=i/(mapsX*CELLS);
        return collisions[(cz/CELLS)*mapsX+cx/CELLS][((cz%CELLS)*CELLS+cx%CELLS)*2+1]==0;
    }
    public void dispose(){for(Texture t:textures.values())t.dispose();}
}
