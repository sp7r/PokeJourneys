package journeys.hub.game;

import com.badlogic.gdx.*;
import com.badlogic.gdx.controllers.*;
import com.badlogic.gdx.graphics.*;
import com.badlogic.gdx.graphics.g2d.*;
import com.badlogic.gdx.graphics.g3d.*;
import com.badlogic.gdx.graphics.g3d.decals.*;

import com.badlogic.gdx.math.*;
import com.badlogic.gdx.utils.*;
import net.mgsx.gltf.loaders.glb.GLBLoader;
import net.mgsx.gltf.scene3d.scene.SceneAsset;
import net.mgsx.gltf.scene3d.shaders.PBRShaderProvider;
import java.nio.file.Path;
import java.nio.file.Files;
import java.util.ArrayList;

/** Standalone hub simulation; the desktop module owns window creation. */
public final class HubGame extends ApplicationAdapter {
    final Path data,work,config,art;
    private final boolean review,tour,auto;
    public boolean failed;
    private final ArrayList<SceneAsset> assets=new ArrayList<>();
    final ArrayList<ModelInstance> models=new ArrayList<>();
    private ModelBatch modelsBatch;
    private SpriteBatch ui;
    private BitmapFont font;
    PerspectiveCamera camera;
    private DecalBatch decals;
    private Decal player;
    /** A townsperson: stands still, or wanders within a radius of home when the entry has "wander". */
    private static final class Walker {
        Decal decal; TextureRegion[][] frames; float x,z,homeX,homeZ,radius,tx,tz,wait,anim; int dir; boolean moving; String name,text;
    }
    private final ArrayList<Walker> npcs=new ArrayList<>();
    private final java.util.Random npcRandom=new java.util.Random(11);
    private final ArrayList<Decal> sprites=new ArrayList<>();
    private final ArrayList<Texture> npcSheets=new ArrayList<>();
    private final Texture[] sheets=new Texture[2];
    private final TextureRegion[][][] frames=new TextureRegion[2][4][4];
    private final Vector2 position=new Vector2(), follow=new Vector2();
    private float followY;
    JsonValue world; private JsonValue character;
    private HubEditor editor;
    private final boolean edit,editSelftest;
    private final java.util.Map<String,SceneAsset> modelCache=new java.util.HashMap<>();
    private Ground ground;
    private String error,zone="PWT Plaza";
    private int direction=0,reviewStep=0,settle=0,tourStep=0;
    private float animTime=0,reviewTime=0,worldScale=1;
    private boolean moving,running;
    private java.io.PrintWriter reviewLog;
    /** Playing (not review, tour or editor): HeartGold-style walking tile by tile, its field camera, signs to read. */
    private final boolean play;
    private float tile=20,originX=0,originZ=0;
    private final Vector2 stepFrom=new Vector2(),stepTo=new Vector2();
    private float stepT,stepTime,turnTimer,bannerTime;
    private boolean stepping;
    private int stepCount;
    private String message;
    private Texture white;
    private ShapeRendererHolder shapes;
    private boolean aWas,bWas;
    /** Test hook: in play, walk the listed directions (0-3), open the facing sign, save hub-shots/play.png and exit. */
    public String playShot;
    private int shotFrames;
    /** Directions by sprite row: 0 down (+z), 1 left (-x), 2 right (+x), 3 up (-z). */
    private static final int[] DX={0,-1,1,0},DZ={1,0,0,-1};
    // HeartGold field camera type 0 (camera table in the pret decomp, as in the Godot overworld): distance
    // 0x29AEC1 fx32 = 41.7 tiles, pitch 0xDD62 = 48.7 degrees down, perspective 0x05C1 = 8.1 degrees half-angle.
    private static final float CAM_TILES=0x29AEC1/4096f/16f, CAM_PITCH=(65536-0xDD62)*360f/65536f, CAM_FOV=0x05C1*360f/65536f*2f;
    private static final float WALK_TIME=.25f, RUN_TIME=.13f, TURN_TIME=.1f;
    /** A step may rise or drop at most this much between tile centres: stairs pass, cliffs and deck edges do not. */
    private static final float GRID_STEP=12;
    /** ShapeRenderer, kept in a holder so the class stays loadable without touching GL at construction. */
    private static final class ShapeRendererHolder { final com.badlogic.gdx.graphics.glutils.ShapeRenderer r=new com.badlogic.gdx.graphics.glutils.ShapeRenderer(); }

    public HubGame(Path data,Path work,Path config,Path art,boolean review,boolean tour,boolean edit,boolean editSelftest) {
        this.data=data; this.work=work; this.config=config; this.art=art; this.review=review; this.tour=tour; auto=review||tour||editSelftest; this.edit=edit; this.editSelftest=editSelftest;
        play=!review&&!tour&&!edit;
    }
    @Override public void create() {
        ui=new SpriteBatch(); font=new BitmapFont(); font.getData().setScale(1.25f);
        try {
            world=read(config.resolve("world.json")); character=read(config.resolve("character.json"));
            worldScale=world.getFloat("worldScale",1);
            if(!Float.isFinite(worldScale)||worldScale<=0)throw new IllegalArgumentException("worldScale must be positive");
            modelsBatch=new ModelBatch(PBRShaderProvider.createDefault(128));
            camera=new PerspectiveCamera(35,Gdx.graphics.getWidth(),Gdx.graphics.getHeight());
            camera.near=10; camera.far=16000;
            decals=new DecalBatch(new CameraGroupStrategy(camera));
            refreshGround(); refreshModels(); buildCharacter();
            System.out.println("Connected gamepads: "+Controllers.getControllers().size);
            position.set(world.get("spawn").getFloat("x"),world.get("spawn").getFloat("z"));
            if(!edit&&!canStand(position.x,position.y)) throw new IllegalStateException("Spawn is not walkable");
            if(play) {
                JsonValue tiles=world.get("ground").get("tiles");
                if(tiles!=null) { tile=tiles.getFloat("size",20); originX=tiles.getFloat("x",0); originZ=tiles.getFloat("z",0); }
                position.set(snapToTile(position.x,position.y));
                camera.fieldOfView=CAM_FOV; camera.near=150/16f*tile; camera.far=(1200/16f+CAM_TILES)*tile*2;
                Pixmap p=new Pixmap(1,1,Pixmap.Format.RGBA8888); p.setColor(Color.WHITE); p.fill(); white=new Texture(p); p.dispose();
                shapes=new ShapeRendererHolder();
                Gdx.input.setCatchKey(Input.Keys.BACK,true);
                updateZone(); bannerTime=2.5f;
            }
            follow.set(position); followY=ground.height(position.x,position.y); updateCamera(1);
            if(edit)editor=new HubEditor(this,editSelftest);
            if(review) {
                Files.createDirectories(work.resolve("hub-shots"));
                reviewLog=new java.io.PrintWriter(Files.newBufferedWriter(work.resolve("hub-shots/review.txt")));
                checkCollision();
            }
            if(tour) {
                Files.createDirectories(work.resolve("hub-shots/tour"));
                try(java.util.stream.Stream<Path> shots=Files.list(work.resolve("hub-shots/tour"))) {
                    for(Path shot:(Iterable<Path>)shots.filter(p->p.getFileName().toString().matches("[0-9]{2}-.*\\.png"))::iterator)Files.delete(shot);
                }
                reviewLog=new java.io.PrintWriter(Files.newBufferedWriter(work.resolve("hub-shots/tour/tour.txt")));
            }
        } catch(Throwable e) { // errors too (a missing platform call, out of memory): shown on screen instead of closing
            failed=true;
            error=!Files.exists(config.resolve("world.json"))
                ? "Game data not found in "+data+". Copy it there first (node tools/hub/android-data.js --push, see hub/README.md)."
                : "Cannot load hub data: "+e;
            System.err.println(error); e.printStackTrace();
            if(auto) Gdx.app.exit();
        }
    }
    void refreshModels() throws Exception {
        models.clear();
        for(JsonValue entry:world.get("models")) {
            String file=entry.getString("file");
            SceneAsset asset=modelCache.get(file);
            if(asset==null) {
                Path source=data.resolve(file).toRealPath();
                if(!source.startsWith(data))throw new IllegalArgumentException("Model path escapes data directory");
                asset=new GLBLoader().load(Gdx.files.absolute(GlbPacking.pack(source,work.resolve("hub-cache")).toString()));
                assets.add(asset); modelCache.put(file,asset);
            }
            ModelInstance instance=new ModelInstance(asset.scene.model);
            float mx=entry.getFloat("x"),mz=entry.getFloat("z");
            instance.transform.setToTranslation(mx,ground.height(mx,mz)+entry.getFloat("y",0),mz);
            instance.transform.rotate(Vector3.Y,entry.getFloat("rotY",0));
            float scale=entry.getFloat("scale",1); instance.transform.scale(scale,scale,scale);
            models.add(instance);
        }
    }
    void refreshNpcs() {
        for(Texture t:npcSheets)t.dispose(); npcSheets.clear(); npcs.clear();
        for(Texture t:sheets)if(t!=null)t.dispose();
        buildCharacter();
    }
    // readAllBytes, not Files.readString: Android only has the Java 7 java.nio.file calls before Android 14
    private JsonValue read(Path path) throws Exception { return new JsonReader().parse(new String(Files.readAllBytes(path),java.nio.charset.StandardCharsets.UTF_8)); }
    private void buildCharacter() {
        for(int motion=0;motion<2;motion++) {
            String name=motion==0?"walk":"run";
            sheets[motion]=buildSheet(name,character.get("tints"));
            TextureRegion[][] split=TextureRegion.split(sheets[motion],32,32);
            for(int row=0;row<4;row++)for(int col=0;col<4;col++) frames[motion][row][col]=split[row][col];
        }
        float size=character.getFloat("spriteSize")/worldScale;
        player=Decal.newDecal(size,size,frames[0][0][0],true);
        JsonValue entries=world.get("npcs");
        if(entries!=null)for(JsonValue entry:entries) {
            Texture sheet=buildSheet("walk",entry.get("tints"));
            npcSheets.add(sheet);
            Walker w=new Walker(); w.frames=TextureRegion.split(sheet,32,32);
            w.name=entry.getString("name",""); w.text=entry.getString("text",null);
            w.x=w.homeX=w.tx=entry.getFloat("x"); w.z=w.homeZ=w.tz=entry.getFloat("z");
            w.dir=entry.getInt("facing",0); w.radius=entry.getFloat("wander",0); w.wait=npcRandom.nextFloat()*3;
            w.decal=Decal.newDecal(size,size,w.frames[w.dir][0],true);
            w.decal.setPosition(w.x,ground.height(w.x,w.z)+16/worldScale,w.z);
            npcs.add(w);
        }
    }
    private Texture buildSheet(String name,JsonValue tints) {
            Pixmap composite=new Pixmap(128,128,Pixmap.Format.RGBA8888);
            int layerIndex=0;
            for(JsonValue layer:character.get("layers")) {
                Path path=art.resolve(layer.asString().replace("{motion}",name));
                Pixmap part=new Pixmap(Gdx.files.absolute(path.toString()));
                if(part.getWidth()!=128||part.getHeight()!=128) throw new IllegalArgumentException("Expected 128x128 sheet: "+path);
                Color tint=Color.valueOf(tints.getString(layerIndex++));
                part.setBlending(Pixmap.Blending.None);
                Color pixel=new Color();
                for(int y=0;y<128;y++)for(int x=0;x<128;x++) {
                    Color.rgba8888ToColor(pixel,part.getPixel(x,y));
                    pixel.mul(tint); part.drawPixel(x,y,Color.rgba8888(pixel));
                }
                composite.drawPixmap(part,0,0); part.dispose();
            }
            Texture sheet=new Texture(composite); composite.dispose();
            sheet.setFilter(Texture.TextureFilter.Nearest,Texture.TextureFilter.Nearest);
            return sheet;
    }
    void refreshGround() throws Exception {
        if(ground!=null)ground.dispose();
        ground=new Ground(world.get("ground"),data);
        // Billboard scenery (trees, bushes) drawn from ground textures, the way DS overworlds draw them.
        sprites.clear();
        JsonValue entries=world.get("sprites");
        if(entries!=null)for(JsonValue e:entries) {
            Texture t=ground.texture(e.getString("texture"));
            float h=e.getFloat("h",64),w=e.getFloat("w",h*t.getWidth()/t.getHeight());
            Decal d=Decal.newDecal(w,h,new TextureRegion(t),true);
            d.setPosition(e.getFloat("x"),ground.height(e.getFloat("x"),e.getFloat("z"))+h/2+e.getFloat("y",0),e.getFloat("z"));
            sprites.add(d);
        }
    }
    private boolean canStand(float x,float z) {
        float radius=5/worldScale,reach=8/worldScale+radius;
        if(!npcs.isEmpty()) { for(Walker w:npcs)if(Vector2.dst2(x,z,w.x,w.z)<reach*reach)return false; }
        else { JsonValue entries=world.get("npcs");
            if(entries!=null)for(JsonValue npc:entries)if(Vector2.dst2(x,z,npc.getFloat("x"),npc.getFloat("z"))<reach*reach)return false; }
        return canStandScenery(x,z);
    }
    /** Walkable for anyone, ignoring townspeople. */
    private boolean canStandScenery(float x,float z) {
        float radius=5/worldScale;
        JsonValue scenery=world.get("sprites");
        if(scenery!=null)for(JsonValue s:scenery) {
            float block=s.getFloat("block",0);
            if(block>0&&Vector2.dst2(x,z,s.getFloat("x"),s.getFloat("z"))<(block+radius)*(block+radius))return false;
        }
        for(JsonValue b:world.get("blockers")) {
            if(x>b.getFloat("x")-radius&&x<b.getFloat("x")+b.getFloat("w")+radius&&
               z>b.getFloat("z")-radius&&z<b.getFloat("z")+b.getFloat("d")+radius) return false;
        }
        for(int sx=-1;sx<=1;sx++)for(int sz=-1;sz<=1;sz++) {
            if(!ground.contains(x+sx*radius,z+sz*radius,false))return false;
        }
        return true;
    }
    /** Highest rise or drop allowed in one movement step: stairs and ramps pass, ledges, cliffs and boardwalk edges do not. */
    private static final float STEP=6;
    private boolean canStep(float fromX,float fromZ,float toX,float toZ,boolean scenery) {
        if(!(scenery?canStandScenery(toX,toZ):canStand(toX,toZ)))return false;
        return Math.abs(ground.height(toX,toZ)-ground.height(fromX,fromZ))<=STEP;
    }
    private void checkCollision() {
        // Points listed under checks.blocked (water, building interiors, ships) must never be standable.
        JsonValue checks=world.get("checks");
        if(checks!=null&&checks.has("blocked"))for(JsonValue p:checks.get("blocked"))
            if(canStand(p.getFloat(0),p.getFloat(1)))throw new IllegalStateException("Expected blocked point is walkable: "+p.toJson(JsonWriter.OutputType.json));
        for(JsonValue b:world.get("blockers"))if(canStand(b.getFloat("x")+b.getFloat("w")/2,b.getFloat("z")+b.getFloat("d")/2))throw new IllegalStateException("Blocker collision failed");
        for(JsonValue npc:world.get("npcs"))if(canStand(npc.getFloat("x"),npc.getFloat("z")))throw new IllegalStateException("NPC collision failed");
        // Running flat out in each direction from spawn must stop on solid, walkable ground.
        Vector2 saved=new Vector2(position); running=true;
        for(Vector2 dir:new Vector2[]{new Vector2(0,-1),new Vector2(0,1),new Vector2(-1,0),new Vector2(1,0)}) {
            position.set(saved);
            for(int i=0;i<1200;i++)move(dir,1/60f);
            if(!canStand(position.x,position.y))throw new IllegalStateException("Movement left walkable ground at "+position);
        }
        position.set(saved); animTime=0; running=false;
        reviewLog.println("Collision checks: listed water/building/ship points, every blocker and portmaster blocked; long runs from spawn stay on walkable ground.");
    }
    private void updateWalkers(float dt) {
        float speed=36/worldScale,personal=10/worldScale;
        for(Walker w:npcs) {
            if(w.radius<=0)continue;
            if(w.wait>0) { w.wait-=dt; w.moving=false; w.anim=0;
                if(w.wait<=0) { // pick a new spot near home that anyone could stand on
                    for(int i=0;i<8;i++) {
                        float a=npcRandom.nextFloat()*MathUtils.PI2,r=w.radius*(float)Math.sqrt(npcRandom.nextFloat());
                        float x=w.homeX+MathUtils.cos(a)*r,z=w.homeZ+MathUtils.sin(a)*r;
                        if(canStandScenery(x,z)) { w.tx=x; w.tz=z; break; }
                    }
                }
                continue;
            }
            float dx=w.tx-w.x,dz=w.tz-w.z,len=(float)Math.sqrt(dx*dx+dz*dz);
            if(len<1) { w.wait=1.5f+npcRandom.nextFloat()*4; w.moving=false; continue; }
            float step=Math.min(len,speed*dt),nx=w.x+dx/len*step,nz=w.z+dz/len*step;
            boolean clear=canStep(w.x,w.z,nx,nz,true)&&Vector2.dst2(nx,nz,position.x,position.y)>personal*personal*4;
            for(Walker o:npcs)if(o!=w&&Vector2.dst2(nx,nz,o.x,o.z)<personal*personal*2)clear=false;
            if(!clear) { w.tx=w.x; w.tz=w.z; w.wait=.5f+npcRandom.nextFloat()*2; w.moving=false; continue; }
            w.x=nx; w.z=nz; w.moving=true; w.anim+=dt;
            w.dir=Math.abs(dx)>Math.abs(dz)?(dx<0?1:2):(dz<0?3:0);
        }
    }
    // ---------- playing: HeartGold-style movement, signs, banner, touch controls ----------
    private Vector2 snapToTile(float x,float z) {
        float cx=originX+((float)Math.floor((x-originX)/tile)+.5f)*tile, cz=originZ+((float)Math.floor((z-originZ)/tile)+.5f)*tile;
        for(int r=0;r<8;r++)for(int dz=-r;dz<=r;dz++)for(int dx=-r;dx<=r;dx++) {
            if(Math.max(Math.abs(dx),Math.abs(dz))!=r)continue;
            if(canStand(cx+dx*tile,cz+dz*tile))return new Vector2(cx+dx*tile,cz+dz*tile);
        }
        return new Vector2(x,z);
    }
    private boolean canGridStep(Vector2 from,float tx,float tz) {
        if(!canStand(tx,tz)||!canStand((from.x+tx)/2,(from.y+tz)/2))return false;
        if(signAt(tx,tz)!=null)return false;
        return Math.abs(ground.height(tx,tz)-ground.height(from.x,from.y))<=GRID_STEP;
    }
    private JsonValue signAt(float x,float z) {
        JsonValue signs=world.get("signs");
        if(signs!=null)for(JsonValue s:signs)if(Math.abs(s.getFloat("x")-x)<tile/2&&Math.abs(s.getFloat("z")-z)<tile/2)return s;
        return null;
    }
    private void updateZone() {
        String before=zone;
        zone="Victory Island";
        float nearestZone=Float.MAX_VALUE;
        for(JsonValue entry:world.get("zones")) {
            float distance=position.dst(entry.getFloat("x"),entry.getFloat("z"));
            if(distance<entry.getFloat("radius")&&distance<nearestZone) { nearestZone=distance; zone=entry.getString("name"); }
        }
        if(!zone.equals(before))bannerTime=2.5f;
    }
    /** The direction held (0 down, 1 left, 2 right, 3 up) or -1: keys, gamepad, then the touch pad. */
    private int heldDirection() {
        float x=(key(Input.Keys.D,Input.Keys.RIGHT)?1:0)-(key(Input.Keys.A,Input.Keys.LEFT)?1:0);
        float y=(key(Input.Keys.S,Input.Keys.DOWN)?1:0)-(key(Input.Keys.W,Input.Keys.UP)?1:0);
        if(Controllers.getControllers().size>0) {
            Controller pad=Controllers.getControllers().first(); ControllerMapping m=pad.getMapping();
            float ax=pad.getAxis(m.axisLeftX),ay=pad.getAxis(m.axisLeftY);
            if(Math.abs(ax)>.4f)x=ax; if(Math.abs(ay)>.4f)y=ay;
            if(pad.getButton(m.buttonDpadLeft))x=-1; if(pad.getButton(m.buttonDpadRight))x=1;
            if(pad.getButton(m.buttonDpadUp))y=-1; if(pad.getButton(m.buttonDpadDown))y=1;
        }
        Vector2 t=touchPad(); if(t!=null){x=t.x;y=t.y;}
        if(x==0&&y==0)return -1;
        if(Math.abs(x)>Math.abs(y))return x<0?1:2;
        return y<0?3:0;
    }
    private boolean touchControls() { return Gdx.app.getType()==Application.ApplicationType.Android&&Controllers.getControllers().size==0; }
    // on-screen pad (screen units, origin bottom-left): d-pad bottom left, A and B bottom right
    private float padX(){return Gdx.graphics.getHeight()*.2f;} private float padY(){return Gdx.graphics.getHeight()*.24f;} private float padR(){return Gdx.graphics.getHeight()*.15f;}
    private float aX(){return Gdx.graphics.getWidth()-Gdx.graphics.getHeight()*.13f;} private float aY(){return Gdx.graphics.getHeight()*.3f;}
    private float bX(){return Gdx.graphics.getWidth()-Gdx.graphics.getHeight()*.3f;} private float bY(){return Gdx.graphics.getHeight()*.17f;}
    private float buttonR(){return Gdx.graphics.getHeight()*.075f;}
    private Vector2 touchPad() {
        if(!touchControls())return null;
        for(int i=0;i<5;i++)if(Gdx.input.isTouched(i)) {
            float x=Gdx.input.getX(i)-padX(),y=(Gdx.graphics.getHeight()-Gdx.input.getY(i))-padY();
            if(x*x+y*y<padR()*padR()*2.2f&&x*x+y*y>padR()*padR()*.04f)return new Vector2(Math.abs(x)>Math.abs(y)?Math.signum(x):0,Math.abs(y)>=Math.abs(x)?-Math.signum(y):0);
        }
        return null;
    }
    private boolean touched(float cx,float cy) {
        if(!touchControls())return false;
        for(int i=0;i<5;i++)if(Gdx.input.isTouched(i)) {
            float x=Gdx.input.getX(i)-cx,y=(Gdx.graphics.getHeight()-Gdx.input.getY(i))-cy;
            if(x*x+y*y<buttonR()*buttonR()*2)return true;
        }
        return false;
    }
    private boolean buttonA() {
        boolean pad=false;
        if(Controllers.getControllers().size>0){Controller c=Controllers.getControllers().first();pad=c.getButton(c.getMapping().buttonA);}
        return pad||key(Input.Keys.Z,Input.Keys.ENTER)||Gdx.input.isKeyPressed(Input.Keys.SPACE)||touched(aX(),aY());
    }
    private boolean buttonB() {
        boolean pad=false;
        if(Controllers.getControllers().size>0){Controller c=Controllers.getControllers().first();pad=c.getButton(c.getMapping().buttonB);}
        return pad||key(Input.Keys.X,Input.Keys.SHIFT_LEFT)||Gdx.input.isKeyPressed(Input.Keys.SHIFT_RIGHT)||touched(bX(),bY());
    }
    private void updatePlay(float dt) {
        boolean a=buttonA(),b=buttonB(),aPressed=a&&!aWas,bPressed=b&&!bWas; aWas=a; bWas=b;
        if(bannerTime>0)bannerTime-=dt;
        if(Gdx.input.isKeyJustPressed(Input.Keys.BACK)) { if(message!=null)message=null; else Gdx.app.exit(); return; }
        if(message!=null) { moving=false; if(aPressed||bPressed)message=null; return; }
        running=b;
        if(stepping) {
            stepT+=dt; float p=Math.min(1,stepT/stepTime);
            position.set(stepFrom).lerp(stepTo,p);
            if(p<1)return;
            stepping=false; stepCount++; position.set(stepTo); updateZone();
        }
        if(aPressed) { read(); return; }
        int d=heldDirection();
        if(d<0) { moving=false; turnTimer=0; return; }
        if(d!=direction&&!moving) { direction=d; turnTimer=TURN_TIME; return; } // a tap turns on the spot
        direction=d;
        if(turnTimer>0) { turnTimer-=dt; if(turnTimer>0)return; }
        float tx=position.x+DX[d]*tile,tz=position.y+DZ[d]*tile;
        if(canGridStep(position,tx,tz)) { stepFrom.set(position); stepTo.set(tx,tz); stepT=0; stepTime=running?RUN_TIME:WALK_TIME; stepping=true; moving=true; }
        else moving=false;
    }
    /** A on the tile in front: a sign shows its text, a townsperson their line (or name). */
    private void read() {
        float fx=position.x+DX[direction]*tile,fz=position.y+DZ[direction]*tile;
        JsonValue sign=signAt(fx,fz);
        if(sign!=null) { message=sign.getString("text"); return; }
        for(Walker w:npcs)if(Vector2.dst(fx,fz,w.x,w.z)<tile*.8f) {
            w.dir=new int[]{3,2,1,0}[direction]; // face the player
            message=w.text!=null?w.text:w.name; return;
        }
    }
    private void drawPlayHud() {
        float W=Gdx.graphics.getWidth(),H=Gdx.graphics.getHeight(),s=H/360f;
        font.getData().setScale(Math.max(1,s*1.1f));
        if(bannerTime>0) { // location banner, top left, as when entering a new area
            font.setColor(.2f,.22f,.28f,1); GlyphLayout l=new GlyphLayout(font,zone);
            float bw=l.width+28*s,bh=l.height+20*s,by=H-14*s-bh;
            ui.setColor(.16f,.24f,.42f,.92f); ui.draw(white,12*s,by,bw,bh);
            ui.setColor(.96f,.97f,1,1); ui.draw(white,12*s+2*s,by+2*s,bw-4*s,bh-4*s);
            ui.setColor(Color.WHITE); font.setColor(.2f,.22f,.28f,1); font.draw(ui,l,12*s+14*s,by+bh-10*s);
        }
        if(message!=null) { // text box along the bottom
            float bh=70*s,bw=Math.min(W-24*s,560*s),bx=(W-bw)/2,by=10*s;
            ui.setColor(.3f,.45f,.62f,1); ui.draw(white,bx,by,bw,bh);
            ui.setColor(.98f,.98f,.98f,1); ui.draw(white,bx+3*s,by+3*s,bw-6*s,bh-6*s);
            ui.setColor(Color.WHITE); font.setColor(.22f,.22f,.26f,1); font.draw(ui,message,bx+16*s,by+bh-16*s,bw-32*s,Align.left,true);
        }
        font.setColor(Color.WHITE);
    }
    private void drawTouchControls() {
        if(!touchControls())return;
        com.badlogic.gdx.graphics.glutils.ShapeRenderer r=shapes.r;
        r.setProjectionMatrix(ui.getProjectionMatrix());
        Gdx.gl.glEnable(GL20.GL_BLEND); Gdx.gl.glBlendFunc(GL20.GL_SRC_ALPHA,GL20.GL_ONE_MINUS_SRC_ALPHA);
        r.begin(com.badlogic.gdx.graphics.glutils.ShapeRenderer.ShapeType.Filled);
        r.setColor(1,1,1,.18f); r.circle(padX(),padY(),padR(),40);
        r.setColor(1,1,1,.3f); float k=padR()*.33f;
        r.rect(padX()-k/2,padY()-padR()*.85f,k,padR()*1.7f); r.rect(padX()-padR()*.85f,padY()-k/2,padR()*1.7f,k);
        r.setColor(.9f,.3f,.3f,touched(aX(),aY())?.6f:.35f); r.circle(aX(),aY(),buttonR(),32);
        r.setColor(.3f,.4f,.9f,touched(bX(),bY())?.6f:.35f); r.circle(bX(),bY(),buttonR(),32);
        r.end();
        ui.begin(); font.getData().setScale(Gdx.graphics.getHeight()/300f);
        font.draw(ui,"A",aX()-6*Gdx.graphics.getHeight()/300f,aY()+8*Gdx.graphics.getHeight()/300f);
        font.draw(ui,"B",bX()-6*Gdx.graphics.getHeight()/300f,bY()+8*Gdx.graphics.getHeight()/300f);
        ui.end();
    }
    private boolean key(int a,int b) { return Gdx.input.isKeyPressed(a)||Gdx.input.isKeyPressed(b); }
    private Vector2 input() {
        Vector2 v=new Vector2();
        v.x=(key(Input.Keys.D,Input.Keys.RIGHT)?1:0)-(key(Input.Keys.A,Input.Keys.LEFT)?1:0);
        v.y=(key(Input.Keys.S,Input.Keys.DOWN)?1:0)-(key(Input.Keys.W,Input.Keys.UP)?1:0);
        running=key(Input.Keys.SHIFT_LEFT,Input.Keys.SHIFT_RIGHT);
        if(Controllers.getControllers().size>0) {
            Controller pad=Controllers.getControllers().first(); ControllerMapping m=pad.getMapping();
            float x=pad.getAxis(m.axisLeftX),y=pad.getAxis(m.axisLeftY);
            if(Math.abs(x)>.2f)v.x=x; if(Math.abs(y)>.2f)v.y=y;
            if(pad.getButton(m.buttonDpadLeft))v.x=-1; if(pad.getButton(m.buttonDpadRight))v.x=1;
            if(pad.getButton(m.buttonDpadUp))v.y=-1; if(pad.getButton(m.buttonDpadDown))v.y=1;
            running|=pad.getButton(m.buttonA);
        }
        return v.limit(1);
    }
    /** Closest standable point to a zone centre, so the tour can teleport instead of walking. */
    private Vector2 nearestWalkable(float cx,float cz) {
        Vector2 best=null; float bestDistance=Float.MAX_VALUE;
        for(float x=ground.bounds[0];x<=ground.bounds[2];x+=2)for(float z=ground.bounds[1];z<=ground.bounds[3];z+=2) {
            float d=Vector2.dst2(x,z,cx,cz);
            if(d<bestDistance&&canStand(x,z)) { bestDistance=d; best=new Vector2(x,z); }
        }
        if(best==null) throw new IllegalStateException("No walkable point in the hub");
        return best;
    }
    private void tourTeleport() {
        if(tourStep==0) position.set(world.get("spawn").getFloat("x"),world.get("spawn").getFloat("z"));
        else { JsonValue entry=world.get("zones").get(tourStep-1); position.set(nearestWalkable(entry.getFloat("x"),entry.getFloat("z"))); }
        follow.set(position); followY=ground.height(position.x,position.y); direction=0;
    }
    private String tourName() {
        if(tourStep==0) return "00-overview";
        return String.format("%02d-",tourStep)+world.get("zones").get(tourStep-1).getString("name").toLowerCase().replaceAll("[^a-z0-9]+","-");
    }
    private Vector2 scripted(float dt) {
        JsonValue target=world.get("review").get(reviewStep);
        Vector2 delta=new Vector2(target.getFloat("x"),target.getFloat("z")).sub(position);
        running=target.getBoolean("run");
        if(delta.len()<2) { settle+=reviewStep==1?30:1; return reviewStep==1?delta.nor():new Vector2(); }
        // Follow configured waypoints through the avenues.

        reviewTime+=dt;
        if(reviewTime>35)throw new IllegalStateException("Review route blocked at "+position+" toward "+target.getString("name"));
        return delta.nor().scl(Math.min(1,delta.len()));
    }
    private void move(Vector2 v,float dt) {
        moving=v.len2()>.01f;
        if(moving) {
            direction=Math.abs(v.x)>Math.abs(v.y)?(v.x<0?1:2):(v.y<0?3:0);
            animTime+=dt;
            float speed=(running?112:64)/worldScale;
            int steps=Math.max(1,(int)Math.ceil(speed*dt/2));
            for(int i=0;i<steps;i++) {
                float x=position.x+v.x*speed*dt/steps,z=position.y+v.y*speed*dt/steps;
                if(canStep(position.x,position.y,x,position.y,false))position.x=x;
                if(canStep(position.x,position.y,position.x,z,false))position.y=z;
            }
        } else animTime=0;
        zone="PWT Plaza";
        float nearestZone=Float.MAX_VALUE;
        for(JsonValue entry:world.get("zones")) {
            float distance=position.dst(entry.getFloat("x"),entry.getFloat("z"));
            if(distance<entry.getFloat("radius")&&distance<nearestZone) {
                nearestZone=distance; zone=entry.getString("name");
            }
        }
    }
    private void updateCamera(float dt) {
        if(tour&&tourStep==0) {
            float[] b=ground.bounds;float cx=(b[0]+b[2])/2,cz=(b[1]+b[3])/2;
            float height=Math.max((b[2]-b[0])/(camera.viewportWidth/camera.viewportHeight),b[3]-b[1])*1.9f;
            float cy=ground.height(cx,cz);
            camera.position.set(cx,cy+height,cz+height*.42f);
            camera.up.set(0,1,0);camera.lookAt(cx,cy,cz);camera.update();return;
        }
        float blend=1-(float)Math.exp(-7*dt);
        if(play) { // the field camera stays locked on the player, only easing up and down with the ground
            followY+=(ground.height(position.x,position.y)-followY)*(dt>=1?1:blend);
            float d=CAM_TILES*tile,p=CAM_PITCH*MathUtils.degreesToRadians;
            camera.position.set(position.x,followY+d*MathUtils.sin(p),position.y+d*MathUtils.cos(p));
            camera.up.set(0,1,0); camera.lookAt(position.x,followY,position.y); camera.update(); return;
        }
        follow.lerp(position,blend);
        followY+=(ground.height(position.x,position.y)-followY)*(dt>=1?1:blend);
        float viewHeight=500/worldScale;
        // A zone may ask for a higher tour camera so its whole building fits in the shot.
        if(tour)viewHeight=world.get("zones").get(tourStep-1).getFloat("view",viewHeight);
        float offsetX=0,offsetZ=viewHeight;
        camera.position.set(follow.x+offsetX,followY+viewHeight,follow.y+offsetZ);
        camera.up.set(0,1,0); camera.lookAt(follow.x,followY,follow.y); camera.update();
    }
    @Override public void render() {
        try {
            float dt=auto?1/60f:Math.min(Gdx.graphics.getDeltaTime(),.05f);
            Gdx.gl.glViewport(0,0,Gdx.graphics.getWidth(),Gdx.graphics.getHeight());
            Gdx.gl.glClearColor(.08f,.18f,.24f,1); Gdx.gl.glClear(GL20.GL_COLOR_BUFFER_BIT|GL20.GL_DEPTH_BUFFER_BIT);
            if(error!=null) { ui.begin();font.draw(ui,error,20,Gdx.graphics.getHeight()-40, Gdx.graphics.getWidth()-40,Align.left,true);ui.end();return; }
            if(!edit&&Gdx.input.isKeyJustPressed(Input.Keys.ESCAPE))Gdx.app.exit();
            if(tour&&settle==0)tourTeleport();
            if(edit)editor.update(dt);
            else if(play) { updatePlay(dt); updateCamera(dt); }
            else { move(review?scripted(dt):tour?new Vector2():input(),dt); updateCamera(dt); }
            if(tour)settle++;
            // Ground first in its own pass, so its cutout overlays never sort in front of model shadows.
            modelsBatch.begin(camera);modelsBatch.render(ground.instance);modelsBatch.end();
            modelsBatch.begin(camera);for(ModelInstance m:models)modelsBatch.render(m);modelsBatch.end();
            int motion=running?1:0;
            int frame=moving?(int)(animTime/character.getFloat(running?"runFrameSeconds":"walkFrameSeconds"))%4:0;
            // one tile is half a walk cycle: a foot forward, then back to standing; the other foot on the next tile
            if(play)frame=stepping?(stepT/stepTime<.5f?(stepCount%2==0?1:3):(stepCount%2==0?2:0)):0;
            player.setTextureRegion(frames[motion][direction][frame]);
            // Lift the sheet so its bottom opaque foot pixels sit on the ground plane.
            player.setPosition(position.x,ground.height(position.x,position.y)+16/worldScale,position.y);
            player.lookAt(new Vector3(player.getPosition()).sub(camera.direction),camera.up);
            if(!edit)decals.add(player);
            for(Decal s:sprites) {
                s.lookAt(new Vector3(s.getPosition()).sub(camera.direction),camera.up);
                decals.add(s);
            }
            if(!edit&&!auto)updateWalkers(dt); // automated runs keep townspeople at home so results repeat
            for(Walker w:npcs) {
                w.decal.setTextureRegion(w.frames[w.dir][w.moving?(int)(w.anim/character.getFloat("walkFrameSeconds"))%4:0]);
                w.decal.setPosition(w.x,ground.height(w.x,w.z)+16/worldScale,w.z);
                w.decal.lookAt(new Vector3(w.decal.getPosition()).sub(camera.direction),camera.up);
                decals.add(w.decal);
            }
            decals.flush();
            if(edit)editor.draw();
            ui.begin();
            font.setColor(.6f,.95f,1,1);
            font.getData().setScale(tour&&tourStep==0?1:1.25f);
            java.util.ArrayList<com.badlogic.gdx.math.Rectangle> labels=new java.util.ArrayList<>();
            // floating place names only in the tour and editor views; in play the signs by the doors name the buildings
            if(!play)for(JsonValue entry:world.get("zones")) {
                Vector3 p=new Vector3(entry.getFloat("x"),55+ground.height(entry.getFloat("x"),entry.getFloat("z")),entry.getFloat("z"));
                if(camera.frustum.pointInFrustum(p)) {
                    camera.project(p);GlyphLayout label=new GlyphLayout(font,entry.getString("name"));
                    com.badlogic.gdx.math.Rectangle box=new com.badlogic.gdx.math.Rectangle(p.x-label.width/2,p.y-label.height,label.width,label.height+5);
                    boolean overlap;do {overlap=false;for(com.badlogic.gdx.math.Rectangle previous:labels)if(box.overlaps(previous)){box.y-=label.height+7;overlap=true;break;}}while(overlap);
                    if(box.y>55&&box.y+box.height<Gdx.graphics.getHeight()-70){font.draw(ui,label,box.x,box.y+label.height);labels.add(box);}
                }
            }
            font.getData().setScale(1.25f);
            font.setColor(Color.WHITE);
            if(edit)editor.hud(ui,font);
            else if(play)drawPlayHud();
            else {
            font.draw(ui,"POKEMON JOURNEYS  /  "+zone,20,Gdx.graphics.getHeight()-22);
            font.draw(ui,"WASD / Arrows: walk   Shift: run   Gamepad: left stick / D-pad + A   Esc: exit",20,28);
            }
            ui.end();
            if(play)drawTouchControls();
            if(play&&playShot!=null)playShotStep();
            if(edit)editor.afterRender();
            if(review&&settle>=30)capture();
            if(tour&&settle>=30)captureTour();
        } catch(Throwable e) { failed=true;error=String.valueOf(e);e.printStackTrace(); if(auto)Gdx.app.exit(); }
    }
    private void capture() {
        String name=world.get("review").get(reviewStep).getString("name");
        Pixmap shot=Pixmap.createFromFrameBuffer(0,0,Gdx.graphics.getWidth(),Gdx.graphics.getHeight());
        PixmapIO.writePNG(Gdx.files.absolute(work.resolve("hub-shots/"+name+".png").toString()),shot,-1,true);shot.dispose();
        reviewLog.println(name+" position="+position+" zone="+zone+" moving="+moving+" running="+running+" walkable="+canStand(position.x,position.y)); reviewLog.flush();
        System.out.println("Saved "+name+" at "+position);
        settle=0;reviewTime=0;reviewStep++;
        if(reviewStep==world.get("review").size)Gdx.app.exit();
    }
    private void playShotStep() {
        shotFrames++;
        if(shotFrames%20==0&&!stepping&&shotFrames/20-1<playShot.length()) { // one scripted step every 20 frames
            int d=playShot.charAt(shotFrames/20-1)-'0';
            if(d>=0&&d<=3) { direction=d; float tx=position.x+DX[d]*tile,tz=position.y+DZ[d]*tile;
                if(canGridStep(position,tx,tz)) { stepFrom.set(position); stepTo.set(tx,tz); stepT=0; stepTime=WALK_TIME; stepping=true; moving=true; } }
            else if(playShot.charAt(shotFrames/20-1)=='a')read();
        }
        if(shotFrames==20*(playShot.length()+2)) {
            Pixmap shot=Pixmap.createFromFrameBuffer(0,0,Gdx.graphics.getWidth(),Gdx.graphics.getHeight());
            try { Files.createDirectories(work.resolve("hub-shots")); } catch(Exception e) { throw new RuntimeException(e); }
            PixmapIO.writePNG(Gdx.files.absolute(work.resolve("hub-shots/play.png").toString()),shot,-1,true);shot.dispose();
            System.out.println("Saved play.png at "+position+" zone="+zone+" message="+message);
            Gdx.app.exit();
        }
    }
    private void captureTour() {
        String name=tourName();
        Pixmap shot=Pixmap.createFromFrameBuffer(0,0,Gdx.graphics.getWidth(),Gdx.graphics.getHeight());
        PixmapIO.writePNG(Gdx.files.absolute(work.resolve("hub-shots/tour/"+name+".png").toString()),shot,-1,true);shot.dispose();
        reviewLog.println(name+" position="+position+" zone="+zone+" walkable="+canStand(position.x,position.y)); reviewLog.flush();
        System.out.println("Saved tour/"+name+" at "+position);
        settle=0;tourStep++;
        if(tourStep>world.get("zones").size)Gdx.app.exit();
    }
    @Override public void resize(int width,int height) {
        ui.setProjectionMatrix(new Matrix4().setToOrtho2D(0,0,width,height));
        if(camera!=null) { camera.viewportWidth=width;camera.viewportHeight=height;camera.update(); }
    }
    @Override public void dispose() {
        if(editor!=null)editor.dispose();
        if(reviewLog!=null)reviewLog.close();
        if(decals!=null)decals.dispose(); if(modelsBatch!=null)modelsBatch.dispose();
        if(ground!=null)ground.dispose();
        for(SceneAsset a:assets)a.dispose();for(Texture t:sheets)if(t!=null)t.dispose();
        for(Texture t:npcSheets)t.dispose();
        if(ui!=null)ui.dispose();if(font!=null)font.dispose();
        if(white!=null)white.dispose(); if(shapes!=null)shapes.r.dispose();
    }
}
