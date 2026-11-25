package journeys.hub;

import com.badlogic.gdx.*;
import com.badlogic.gdx.backends.lwjgl3.*;
import com.badlogic.gdx.graphics.*;
import com.badlogic.gdx.graphics.g3d.*;
import com.badlogic.gdx.graphics.glutils.FrameBuffer;
import com.badlogic.gdx.math.Vector3;
import com.badlogic.gdx.math.collision.BoundingBox;
import net.mgsx.gltf.loaders.glb.GLBLoader;
import net.mgsx.gltf.scene3d.scene.SceneAsset;
import net.mgsx.gltf.scene3d.shaders.PBRShaderProvider;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.awt.Graphics2D;
import java.awt.Color;
import java.nio.file.*;
import java.nio.file.Files;
import java.util.*;
import java.util.regex.*;
import com.badlogic.gdx.utils.JsonReader;
import com.badlogic.gdx.utils.JsonValue;
import com.badlogic.gdx.utils.JsonWriter;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.io.ByteArrayOutputStream;

public class Render extends ApplicationAdapter {
    private static Path input, output;
    private static int size = 512;
    private ModelBatch batch;
    private FrameBuffer buffer;
    private int failures;
    public static void main(String[] args) throws Exception {
        if (args.length < 2) throw new IllegalArgumentException("Usage: Render INPUT OUTPUT [SIZE]");
        input = Path.of(args[0]).toRealPath(); output = Path.of(args[1]).toAbsolutePath().normalize();
        if(!output.startsWith(Path.of("C:/Projects/hub-work"))) throw new IllegalArgumentException("Output must be under C:/Projects/hub-work");
        Path repo = Path.of(System.getProperty("user.dir")).toAbsolutePath();
        while (repo != null && !Files.exists(repo.resolve("gradlew"))) repo = repo.getParent();
        if (repo != null && output.startsWith(repo)) throw new IllegalArgumentException("Output must be outside the repository");
        Files.createDirectories(output);
        if (args.length > 2) size = Integer.parseInt(args[2]);
        Lwjgl3ApplicationConfiguration c = new Lwjgl3ApplicationConfiguration();
        c.setTitle("Map model renderer"); c.setWindowedMode(64,64); c.setInitialVisible(false);
        c.disableAudio(true); c.setForegroundFPS(0);
        Render app = new Render(); new Lwjgl3Application(app,c);
        if (app.failures > 0) System.exit(1);
    }
    @Override public void create() {
        try {
            batch = new ModelBatch(PBRShaderProvider.createDefault(128));
            buffer = new FrameBuffer(Pixmap.Format.RGBA8888,size,size,true);
            java.util.List<Path> files;
            try (var stream = Files.walk(input)) { files=stream.filter(p->p.toString().endsWith(".glb")).sorted().toList(); }
            if (files.isEmpty()) throw new IllegalArgumentException("No GLB files in " + input);
            for (Path file : files) {
                try { renderModel(file); } catch (Exception e) { failures++; System.err.println(file + ": " + e); e.printStackTrace(); }
            }
            sheet(files,"top"); sheet(files,"field"); world(files);
        } catch(Exception e) { failures++; e.printStackTrace(); }
        finally { Gdx.app.exit(); }
    }
    private void renderModel(Path file) throws Exception {
        SceneAsset asset = new GLBLoader().load(Gdx.files.absolute(pack(file).toString()));
        try {
            ModelInstance model = new ModelInstance(asset.scene.model);
            BoundingBox bounds = model.calculateBoundingBox(new BoundingBox());
            Vector3 center = bounds.getCenter(new Vector3()), dim = bounds.getDimensions(new Vector3());
            float extent = Math.max(1,Math.max(dim.x,Math.max(dim.y,dim.z)));
            boolean map=base(file).matches("map\\d+_\\d+");
            for (String view : map?new String[]{"top","field","tile"}:new String[]{"top","field"}) {
                Vector3 target=new Vector3(center);
                Camera camera;
                if (!view.equals("field")) {
                    float span = Math.max(1,Math.max(dim.x,dim.z))*1.05f;
                    if(view.equals("tile")) { span=512; target.x=0; target.z=0; }
                    camera = new OrthographicCamera(span,span);
                    camera.position.set(target).add(0,extent*3,0); camera.up.set(0,0,-1);
                } else {
                    camera = new PerspectiveCamera(35,size,size);
                    float distance=0, tangent=(float)Math.tan(Math.toRadians(17.5));
                    for(int i=0;i<8;i++) {
                        float x=((i&1)==0?-.5f:.5f)*dim.x;
                        float y=((i&2)==0?-.5f:.5f)*dim.y;
                        float z=((i&4)==0?-.5f:.5f)*dim.z;
                        float back=(y+z)*.70710678f, up=(y-z)*.70710678f;
                        distance=Math.max(distance,back+Math.max(Math.abs(x),Math.abs(up))/tangent);
                    }
                    camera.position.set(target).add(0,distance*.75f,distance*.75f);
                }
                camera.near=extent*.001f; camera.far=extent*20;
                camera.lookAt(target); camera.update();
                buffer.begin();
                Gdx.gl.glViewport(0,0,size,size); Gdx.gl.glClearColor(.12f,.15f,.18f,1);
                Gdx.gl.glClear(GL20.GL_COLOR_BUFFER_BIT|GL20.GL_DEPTH_BUFFER_BIT);
                batch.begin(camera); batch.render(model); batch.end();
                Pixmap pix = Pixmap.createFromFrameBuffer(0,0,size,size);
                BufferedImage image = new BufferedImage(size,size,BufferedImage.TYPE_INT_ARGB);
                for(int y=0;y<size;y++) for(int x=0;x<size;x++) {
                    int rgba=pix.getPixel(x,size-y-1); image.setRGB(x,y,(rgba>>>8)|((rgba&255)<<24));
                }
                pix.dispose(); buffer.end();
                ImageIO.write(image,"PNG",output.resolve(base(file)+"-"+view+".png").toFile());
            }
            System.out.println(base(file)+" bounds="+bounds);
        } finally { asset.dispose(); }
    }
    private static String base(Path p) {
        String name=p.getFileName().toString().replaceFirst("\\.glb$","");
        String parent=p.getParent().getFileName().toString();
        return parent.matches(Pattern.quote(name)+"\\.\\d+")?parent:name;
    }
    // Some exporters emit GLB geometry with external PNGs. Embed those for the GLB loader.
    private Path pack(Path file) throws Exception {
        byte[] data=Files.readAllBytes(file); ByteBuffer b=ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);
        int jsonLength=b.getInt(12);
        JsonValue root=new JsonReader().parse(new String(data,20,jsonLength,java.nio.charset.StandardCharsets.UTF_8));
        boolean changed=false;
        // The loader's RGB byte path misreads four-byte-stride colors. Expose the opaque padding as alpha.
        for(JsonValue mesh:root.get("meshes"))for(JsonValue primitive:mesh.get("primitives")) {
            JsonValue color=primitive.get("attributes").get("COLOR_0");
            if(color==null)continue;
            JsonValue accessor=root.get("accessors").get(color.asInt());
            JsonValue view=root.get("bufferViews").get(accessor.getInt("bufferView"));
            if(accessor.getString("type").equals("VEC3") && accessor.getInt("componentType")==5121 && view.getInt("byteStride",0)==4) {
                int offset=28+jsonLength+view.getInt("byteOffset",0)+accessor.getInt("byteOffset",0);
                boolean opaque=true;
                for(int i=0;i<accessor.getInt("count");i++)if((data[offset+i*4+3]&255)!=255)opaque=false;
                if(opaque){ accessor.get("type").set("VEC4"); changed=true; }
            }
        }
        JsonValue images=root.get("images"); boolean external=false;
        if(images!=null)for(JsonValue img:images)if(img.has("uri"))external=true;
        if(!external&&!changed)return file;
        ByteArrayOutputStream bin=new ByteArrayOutputStream();
        int start=20+jsonLength; int length=b.getInt(start);bin.write(data,start+8,length);
        JsonValue views=root.get("bufferViews");
        if(images!=null)for(JsonValue img:images) {
            if(!img.has("uri"))continue;
            byte[] png=Files.readAllBytes(file.getParent().resolve(img.getString("uri")));
            while(bin.size()%4!=0)bin.write(0);
            JsonValue view=new JsonValue(JsonValue.ValueType.object);
            view.addChild("buffer",new JsonValue(0L));view.addChild("byteOffset",new JsonValue((long)bin.size()));view.addChild("byteLength",new JsonValue((long)png.length));
            int index=views.size; views.addChild(view);bin.write(png);
            img.remove("uri"); img.addChild("bufferView",new JsonValue((long)index));img.addChild("mimeType",new JsonValue("image/png"));
        }
        while(bin.size()%4!=0)bin.write(0);
        root.get("buffers").get(0).get("byteLength").set((long)bin.size(),null);
        byte[] json=root.toJson(JsonWriter.OutputType.json).getBytes(java.nio.charset.StandardCharsets.UTF_8);
        int padded=(json.length+3)&~3;
        ByteBuffer result=ByteBuffer.allocate(12+8+padded+8+bin.size()).order(ByteOrder.LITTLE_ENDIAN);
        result.putInt(0x46546c67).putInt(2).putInt(result.capacity()).putInt(padded).putInt(0x4e4f534a).put(json);
        while(result.position()<20+padded)result.put((byte)32);
        result.putInt(bin.size()).putInt(0x004e4942).put(bin.toByteArray());
        Path packed=output.resolve("packed").resolve(base(file)+".glb");Files.createDirectories(packed.getParent());Files.write(packed,result.array());return packed;
    }
    private void sheet(java.util.List<Path> files,String view) throws Exception {
        int tile=192, cols=Math.min(10,files.size()), rows=(files.size()+cols-1)/cols;
        BufferedImage image=new BufferedImage(cols*tile,rows*(tile+24),BufferedImage.TYPE_INT_RGB);
        Graphics2D g=image.createGraphics(); g.setColor(Color.DARK_GRAY); g.fillRect(0,0,image.getWidth(),image.getHeight());
        for(int i=0;i<files.size();i++) {
            Path p=output.resolve(base(files.get(i))+"-"+view+".png"); if(!Files.exists(p)) continue;
            int x=(i%cols)*tile,y=(i/cols)*(tile+24);
            g.drawImage(ImageIO.read(p.toFile()),x,y,tile,tile,null);g.setColor(Color.WHITE);g.drawString(base(files.get(i)),x+3,y+tile+16);
        }
        g.dispose(); ImageIO.write(image,"PNG",output.resolve("contact-"+view+".png").toFile());
    }
    private void world(java.util.List<Path> files) throws Exception {
        Pattern pattern=Pattern.compile("map(\\d+)_(\\d+)"); int maxX=0,maxY=0;
        for(Path f:files) { Matcher m=pattern.matcher(base(f)); if(m.matches()){maxX=Math.max(maxX,Integer.parseInt(m.group(1)));maxY=Math.max(maxY,Integer.parseInt(m.group(2)));} }
        if(maxX==0&&maxY==0)return;
        int tile=256; BufferedImage image=new BufferedImage((maxX+1)*tile,(maxY+1)*tile,BufferedImage.TYPE_INT_RGB);
        Graphics2D g=image.createGraphics();
        for(Path f:files) { Matcher m=pattern.matcher(base(f)); if(!m.matches())continue;
            Path png=output.resolve(base(f)+"-tile.png");if(!Files.exists(png))continue;
            int x=Integer.parseInt(m.group(1))*tile,y=Integer.parseInt(m.group(2))*tile;
            g.drawImage(ImageIO.read(png.toFile()),x,y,tile,tile,null);g.setColor(Color.WHITE);g.drawString(base(f),x+4,y+16);
        }
        g.dispose();ImageIO.write(image,"PNG",output.resolve("world-grid.png").toFile());
    }
    @Override public void dispose(){if(batch!=null)batch.dispose();if(buffer!=null)buffer.dispose();}
}
