package journeys.hub.game;

import com.badlogic.gdx.Gdx;
import com.badlogic.gdx.graphics.*;
import com.badlogic.gdx.graphics.g3d.*;
import com.badlogic.gdx.graphics.g3d.attributes.*;
import com.badlogic.gdx.graphics.g3d.utils.*;
import com.badlogic.gdx.math.EarClippingTriangulator;
import com.badlogic.gdx.math.Vector2;
import com.badlogic.gdx.utils.*;
import net.mgsx.gltf.scene3d.attributes.*;
import java.nio.file.Path;
import java.util.*;

/**
 * Generated town ground built from polygons in world.json.
 * Kinds: plaza, garden, pier (walkable land with sea walls and railings on the coast),
 * avenue (walkable inlay), deco (flat overlay with no effect on walking) and
 * box (raised block such as a hedge or planter that blocks walking) and shallows (lighter water just above the sea).
 * With ground.tiles, a DS Map Studio export replaces the plaza, garden, avenue, shallows and deco shapes
 * (decos marked "overTiles" are still drawn on top) and its collision files decide where land is walkable.
 */
final class Ground implements Disposable {
    static final List<String> KINDS=Arrays.asList("plaza","garden","pier","avenue","deco","box","shallows");
    private static final List<String> LAND=Arrays.asList("plaza","garden","pier");
    private Model model;
    ModelInstance instance;
    private final Map<String,Texture> textures=new HashMap<>();
    private final Map<String,Material> materials=new HashMap<>();
    private final JsonValue rectangles;
    private final TileGround tiles;
    final float[] bounds={Float.MAX_VALUE,Float.MAX_VALUE,-Float.MAX_VALUE,-Float.MAX_VALUE};

    Ground(JsonValue config,Path data) throws Exception {
        rectangles=config.get("rectangles");
        tiles=config.has("tiles")?new TileGround(config.get("tiles"),data):null;
        if(tiles!=null)System.arraycopy(tiles.bounds,0,bounds,0,4);
        for(JsonValue r:rectangles) {
            if(!KINDS.contains(r.getString("kind")))throw new IllegalArgumentException("Unknown ground kind: "+r.getString("kind"));
            float[] p=points(r);
            if(p.length<6)throw new IllegalArgumentException("Ground needs three vertices");
            for(int i=0;i<p.length;i+=2) {
                if(!Float.isFinite(p[i])||!Float.isFinite(p[i+1]))throw new IllegalArgumentException("Invalid ground vertex");
                if(!LAND.contains(r.getString("kind"))||!drawn(r))continue;
                bounds[0]=Math.min(bounds[0],p[i]);bounds[1]=Math.min(bounds[1],p[i+1]);
                bounds[2]=Math.max(bounds[2],p[i]);bounds[3]=Math.max(bounds[3],p[i+1]);
            }
        }
        for(JsonValue e:config.get("textures")) {
            Path path=data.resolve(e.asString()).toRealPath();
            if(!path.startsWith(data))throw new IllegalArgumentException("Texture path escapes data directory");
            Texture t=new Texture(Gdx.files.absolute(path.toString()));
            t.setWrap(Texture.TextureWrap.Repeat,Texture.TextureWrap.Repeat);t.setFilter(Texture.TextureFilter.Nearest,Texture.TextureFilter.Nearest);
            textures.put(e.name,t);
            Material m=new Material(PBRTextureAttribute.createBaseColorTexture(t),new PBRFlagAttribute(PBRFlagAttribute.Unlit),IntAttribute.createCullFace(GL20.GL_NONE));
            m.set(FloatAttribute.createAlphaTest(.5f));
            m.set(new BlendingAttribute(true,1f));
            materials.put(e.name,m);
        }
        ModelBuilder builder=new ModelBuilder();builder.begin();
        // With tiles the open sea continues the tile sea, just below it, at one texture repeat per tile.
        float sea=tiles!=null?tiles.seaLevel-.5f:-24,repeat=tiles!=null?config.get("tiles").getFloat("size"):32;
        floor(builder,material("water"),bounds[0]-10000,bounds[1]-10000,bounds[2]+10000,bounds[3]+10000,sea,repeat);
        if(tiles!=null)tiles.build(builder);
        int order=0,landOrder=0;
        for(JsonValue r:rectangles) {
            if(!drawn(r))continue;
            String kind=r.getString("kind");float[] p=points(r);
            Material top=material(r.getString("texture",kind));
            float scale=32*r.getFloat("tile",1);
            // Later land shapes sit a hair higher so overlapping land never z-fights; overlays stack by layer.
            // On tile ground, boxes and overlays stand on the terrain under their centre; piers use their own "y" (deck height).
            float cx=0,cz=0;for(int i=0;i<p.length;i+=2){cx+=p[i];cz+=p[i+1];}cx/=p.length/2f;cz/=p.length/2f;
            float base=tiles!=null&&!kind.equals("pier")?tiles.height(cx,cz):0,deck=r.getFloat("y",0);
            float y=kind.equals("shallows")?-23.5f+.05f*r.getFloat("layer",0):kind.equals("box")?base+r.getFloat("height",12):kind.equals("avenue")?.5f:kind.equals("deco")?base+.7f+.2f*r.getFloat("layer",1)+.002f*order:deck+.04f*landOrder++ +(tiles!=null?.5f:0);
            order++;
            ShortArray triangles=new EarClippingTriangulator().computeTriangles(p);
            MeshPartBuilder mesh=part(builder,top);
            for(int i=0;i<triangles.size;i+=3) {
                int a=triangles.get(i)*2,b=triangles.get(i+1)*2,c=triangles.get(i+2)*2;
                float ya=y,yb=y,yc=y;
                if(kind.equals("pier")){float lift=y-deck;ya=deckAt(r,p[a],p[a+1])+lift;yb=deckAt(r,p[b],p[b+1])+lift;yc=deckAt(r,p[c],p[c+1])+lift;}
                mesh.triangle(vertex(p[a],ya,p[a+1],p[a]/scale,p[a+1]/scale),vertex(p[b],yb,p[b+1],p[b]/scale,p[b+1]/scale),vertex(p[c],yc,p[c+1],p[c]/scale,p[c+1]/scale));
            }
            if(kind.equals("box")) {
                // "sides" may give one texture per edge (e.g. crowd facing the field, scaffolding outside).
                Material side=material(r.getString("side",r.getString("texture",kind)));
                JsonValue sides=r.get("sides");
                for(int i=0;i<p.length;i+=2){int j=(i+2)%p.length;
                    wall(builder,sides!=null?material(sides.getString(i/2)):side,p[i],p[i+1],p[j],p[j+1],base+r.getFloat("base",0),y);}
                continue;
            }
            if(!LAND.contains(kind))continue;
            Material wallMaterial=material(r.getString("wall",kind.equals("pier")?"pierWall":"wall"));
            Material rail=r.getBoolean("railing",true)?material(r.getString("rail","railing")):null;
            for(int i=0;i<p.length;i+=2) {
                int j=(i+2)%p.length;float ax=p[i],az=p[i+1],dx=p[j]-ax,dz=p[j+1]-az;
                float length=Vector2.len(dx,dz);if(length<.001f)continue;
                TreeSet<Float> cuts=new TreeSet<>();cuts.add(0f);cuts.add(1f);
                for(JsonValue other:rectangles) {
                    if(!LAND.contains(other.getString("kind"))||!drawn(other))continue;
                    float[] q=points(other);
                    for(int k=0;k<q.length;k+=2) {
                        int l=(k+2)%q.length;float ex=q[l]-q[k],ez=q[l+1]-q[k+1],rx=q[k]-ax,rz=q[k+1]-az;
                        float cross=dx*ez-dz*ex;
                        if(Math.abs(cross)>.0001f) {
                            float t=(rx*ez-rz*ex)/cross,u=(rx*dz-rz*dx)/cross;
                            if(t>.00001f&&t<.99999f&&u>=0&&u<=1)cuts.add(t);
                        }else if(Math.abs(rx*dz-rz*dx)<.01f) {
                            float t=(rx*dx+rz*dz)/(length*length),u=t+(ex*dx+ez*dz)/(length*length);
                            if(t>.00001f&&t<.99999f)cuts.add(t);if(u>.00001f&&u<.99999f)cuts.add(u);
                        }
                    }
                }
                Float last=null;
                for(float t:cuts) {
                    if(last!=null) {
                        float mid=(last+t)/2,x=ax+dx*mid,z=az+dz*mid,nx=-dz/length*.05f,nz=dx/length*.05f;
                        if(land(x+nx,z+nz)!=land(x-nx,z-nz)) {
                            float sx=ax+dx*last,sz=az+dz*last,ex=ax+dx*t,ez=az+dz*t,low=tiles!=null?tiles.seaLevel-1:-24;
                            float ds=kind.equals("pier")?deckAt(r,sx,sz):deck,de=kind.equals("pier")?deckAt(r,ex,ez):deck;
                            wall(builder,wallMaterial,sx,sz,ex,ez,low,ds,low,de);
                            if(rail!=null)wall(builder,rail,sx,sz,ex,ez,ds,ds+16,de,de+16);
                        }
                    }last=t;
                }
            }
        }
        // Upright wheels (rim and spokes) facing the camera, e.g. the Ferris wheel whose rim did not survive conversion.
        JsonValue rings=config.get("rings");
        if(rings!=null)for(JsonValue r:rings) {
            Material m=material(r.getString("texture"));
            float cx=r.getFloat("x"),cz=r.getFloat("z"),cy=r.getFloat("y")+(tiles!=null?tiles.height(cx,cz):0),radius=r.getFloat("radius"),t=r.getFloat("thickness",4);
            int segments=r.getInt("segments",32),spokes=r.getInt("spokes",8);
            MeshPartBuilder mesh=part(builder,m);
            for(int i=0;i<segments;i++) {
                double a=Math.PI*2*i/segments,b=Math.PI*2*(i+1)/segments;
                float ox=(float)Math.cos(a),oy=(float)Math.sin(a),px=(float)Math.cos(b),py=(float)Math.sin(b),in=radius-t,out=radius+t;
                quad(mesh,cx+ox*in,cy+oy*in,cx+ox*out,cy+oy*out,cx+px*out,cy+py*out,cx+px*in,cy+py*in,cz);
            }
            for(int i=0;i<spokes;i++) {
                double a=Math.PI*2*i/spokes;float dx=(float)Math.cos(a),dy=(float)Math.sin(a),nx=-dy*t*.5f,ny=dx*t*.5f;
                quad(mesh,cx+nx,cy+ny,cx+dx*radius+nx,cy+dy*radius+ny,cx+dx*radius-nx,cy+dy*radius-ny,cx-nx,cy-ny,cz);
            }
        }
        model=builder.end();instance=new ModelInstance(model);
    }
    private void quad(MeshPartBuilder mesh,float ax,float ay,float bx,float by,float cx,float cy,float dx,float dy,float z) {
        mesh.rect(vertex(ax,ay,z,0,0),vertex(bx,by,z,1,0),vertex(cx,cy,z,1,1),vertex(dx,dy,z,0,1));
    }
    private Material material(String name) {
        Material m=materials.get(name);
        if(m==null)throw new IllegalArgumentException("Ground texture not listed in ground.textures: "+name);
        return m;
    }
    /** Texture by its ground.textures name, for sprites that share the ground's texture list. */
    Texture texture(String name) {
        Texture t=textures.get(name);
        if(t==null)throw new IllegalArgumentException("Texture not listed in ground.textures: "+name);
        return t;
    }
    static float[] points(JsonValue r) {
        if(r.has("points")) {
            float[] p=new float[r.get("points").size*2];int i=0;
            for(JsonValue v:r.get("points")){p[i++]=v.getFloat(0);p[i++]=v.getFloat(1);}return p;
        }
        float x=r.getFloat("x"),z=r.getFloat("z"),w=r.getFloat("w"),d=r.getFloat("d");
        if(w<=0||d<=0)throw new IllegalArgumentException("Ground dimensions must be positive");
        return new float[]{x,z,x+w,z,x+w,z+d,x,z+d};
    }
    static boolean inside(JsonValue r,float x,float z) {
        float[] p=points(r);boolean in=false;
        for(int i=0,j=p.length-2;i<p.length;j=i,i+=2) {
            if((p[i+1]>z)!=(p[j+1]>z)&&x<(p[j]-p[i])*(z-p[i+1])/(p[j+1]-p[i+1])+p[i])in=!in;
        }return in;
    }
    /** Shapes that tile ground replaces are kept in world.json for the editor but not drawn or walked on. */
    private boolean drawn(JsonValue r) {
        if(tiles==null)return true;
        String kind=r.getString("kind");
        return kind.equals("pier")||kind.equals("box")||kind.equals("deco")&&r.getBoolean("overTiles",false);
    }
    private boolean land(float x,float z) {
        if(tiles!=null&&tiles.land(x,z))return true;
        for(JsonValue r:rectangles)if(LAND.contains(r.getString("kind"))&&drawn(r)&&inside(r,x,z))return true;
        return false;
    }
    /** Height of the walking surface: a pier deck where one covers the point, otherwise the tile ground (0 without tiles). */
    float height(float x,float z) {
        float deck=-Float.MAX_VALUE;
        for(JsonValue r:rectangles)if(r.getString("kind").equals("pier")&&drawn(r)&&inside(r,x,z))deck=Math.max(deck,deckAt(r,x,z));
        if(deck>-Float.MAX_VALUE)return deck;
        return tiles!=null?tiles.height(x,z):0;
    }
    /** Deck height of a pier at a point: "y", or a ramp from "y" to "y2" across the shape along "axis" (x or z). */
    static float deckAt(JsonValue r,float x,float z) {
        float y=r.getFloat("y",0);
        if(!r.has("y2"))return y;
        boolean alongX=r.getString("axis","x").equals("x");
        float[] p=points(r);float lo=Float.MAX_VALUE,hi=-Float.MAX_VALUE;
        for(int i=alongX?0:1;i<p.length;i+=2){lo=Math.min(lo,p[i]);hi=Math.max(hi,p[i]);}
        float t=hi>lo?Math.max(0,Math.min(1,((alongX?x:z)-lo)/(hi-lo))):0;
        return y+(r.getFloat("y2")-y)*t;
    }
    /** Walkable surface: on land or an avenue, and not inside a raised box. The outline flag limits the test to land. */
    boolean contains(float x,float z,boolean outline) {
        if(outline)return land(x,z);
        boolean surface=false;
        if(tiles!=null&&tiles.walkable(x,z))surface=true;
        for(JsonValue r:rectangles) {
            String kind=r.getString("kind");
            if(!drawn(r))continue;
            if(kind.equals("box")&&inside(r,x,z))return false;
            if((LAND.contains(kind)||kind.equals("avenue"))&&inside(r,x,z))surface=true;
        }
        return surface;
    }
    private MeshPartBuilder part(ModelBuilder b,Material m) {
        return b.part("ground",GL20.GL_TRIANGLES,VertexAttributes.Usage.Position|VertexAttributes.Usage.Normal|VertexAttributes.Usage.TextureCoordinates,m);
    }
    private MeshPartBuilder.VertexInfo vertex(float x,float y,float z,float u,float v) {
        return new MeshPartBuilder.VertexInfo().setPos(x,y,z).setNor(0,1,0).setUV(u,v);
    }
    private void floor(ModelBuilder b,Material m,float x,float z,float right,float bottom,float y,float repeat) {
        part(b,m).rect(vertex(x,y,z,x/repeat,z/repeat),vertex(x,y,bottom,x/repeat,bottom/repeat),vertex(right,y,bottom,right/repeat,bottom/repeat),vertex(right,y,z,right/repeat,z/repeat));
    }
    private void wall(ModelBuilder b,Material m,float x,float z,float bx,float bz,float low,float high) {wall(b,m,x,z,bx,bz,low,high,low,high);}
    /** Upright strip whose bottom and top may slope from the first end (lowA, highA) to the second (lowB, highB). */
    private void wall(ModelBuilder b,Material m,float x,float z,float bx,float bz,float lowA,float highA,float lowB,float highB) {
        float length=Vector2.dst(x,z,bx,bz)/32,ha=(highA-lowA)/32,hb=(highB-lowB)/32;
        MeshPartBuilder mesh=part(b,m);
        mesh.rect(vertex(x,lowA,z,0,ha),vertex(bx,lowB,bz,length,hb),vertex(bx,highB,bz,length,0),vertex(x,highA,z,0,0));
        mesh.rect(vertex(x,highA,z,0,0),vertex(bx,highB,bz,length,0),vertex(bx,lowB,bz,length,hb),vertex(x,lowA,z,0,ha));
    }
    public void dispose(){if(model!=null)model.dispose();for(Texture t:textures.values())t.dispose();if(tiles!=null)tiles.dispose();}
}
