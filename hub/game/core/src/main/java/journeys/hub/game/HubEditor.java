package journeys.hub.game;

import com.badlogic.gdx.*;
import com.badlogic.gdx.graphics.*;
import com.badlogic.gdx.graphics.g2d.*;
import com.badlogic.gdx.graphics.glutils.ShapeRenderer;
import com.badlogic.gdx.math.*;
import com.badlogic.gdx.math.collision.*;
import com.badlogic.gdx.utils.*;
import java.nio.file.*;
import java.nio.file.Path;
import java.nio.file.Files;
import java.util.Collections;
import java.util.*;
import java.util.stream.Stream;

/** Layout controls and overlays sharing the game's models and JSON state. */
final class HubEditor extends InputAdapter {
    private final HubGame game;
    private final ShapeRenderer shapes=new ShapeRenderer();
    private final ArrayList<String> files=new ArrayList<>();
    private final ArrayDeque<String> undo=new ArrayDeque<>();
    private final Vector2 target=new Vector2(650,540);
    private JsonValue selected;
    private String type="models", saved, message="";
    private boolean visible, list, dragging, dragSaved;
    private int choice, frames, vertex=-1;
    private float pickX,pickZ;
    private float height=500, lastX,lastZ;
    private final boolean selftest;
    private final Path output;

    HubEditor(HubGame game,boolean selftest) throws Exception {
        this.game=game; this.selftest=selftest;
        output=selftest?game.work.resolve("hub-shots/editor-test/world.json"):game.config.resolve("world.json");
        saved=snapshot();
        for(String folder:new String[]{"pwt-glb","buildings-glb","decor-glb"}) {
            Path root=game.data.resolve(folder);
            if(Files.isDirectory(root))try(Stream<Path> paths=Files.walk(root)) {
                paths.filter(p->Files.isRegularFile(p)&&p.toString().toLowerCase(Locale.ROOT).endsWith(".glb"))
                    .forEach(p->files.add(game.data.relativize(p).toString().replace('\\','/')));
            }
        }
        Collections.sort(files);
        Gdx.input.setInputProcessor(this);
        if(selftest) {
            Files.createDirectories(output.getParent());
            Files.copy(game.config.resolve("world.json"),output,StandardCopyOption.REPLACE_EXISTING);
            // the Battle Dome when the layout places it as a model, otherwise the first model (buildings may live in the tile map)
            for(JsonValue e:game.world.get("models"))if(e.getString("file").contains("c04tcourt_01"))selected=e;
            if(selected==null&&game.world.get("models").size>0)selected=game.world.get("models").get(0);
            if(selected==null)throw new IllegalStateException("No model to test in world.json");
            String testFile=selected.getString("file");
            float x=selected.getFloat("x"),r=selected.getFloat("rotY",0);
            remember(); set(selected,"x",x+10); set(selected,"rotY",r+15); refresh(); save();
            JsonValue loaded=new JsonReader().parse(Files.readString(output));
            JsonValue dome=null;
            for(JsonValue e:loaded.get("models"))if(e.getString("file").equals(testFile))dome=e;
            if(dome==null||Math.abs(dome.getFloat("x")-x-10)>.01f||Math.abs(dome.getFloat("rotY")-r-15)>.01f)
                throw new IllegalStateException("Editor save/reload mismatch");
            game.world=loaded; selected=dome; saved=snapshot(); refresh();
            String baseline=snapshot();
            type="ground";selected=game.world.get("ground").get("rectangles").get(0);
            int originalVertices=selected.get("points").size;
            float gx=Ground.points(selected)[0];
            remember();move(8,0);insertVertex();refresh();save();
            JsonValue groundReload=new JsonReader().parse(Files.readString(output));
            JsonValue changed=groundReload.get("ground").get("rectangles").get(0);
            if(Ground.points(changed)[0]!=gx+8||!groundReload.child.next.name.equals("ground"))
                throw new IllegalStateException("Ground save/reload mismatch");
            if(changed.get("points").size!=originalVertices+1)throw new IllegalStateException("Vertex insertion failed");
            vertex=0;removeVertex();refresh();
            if(selected.get("points").size!=originalVertices)throw new IllegalStateException("Vertex removal failed");
            float[] before=Ground.points(selected);vertex=1;move(3,4);
            float[] after=Ground.points(selected);
            if(after[0]!=before[0]||after[2]!=before[2]+3||after[3]!=before[3]+4)throw new IllegalStateException("Vertex movement failed");
            while(selected.get("points").size>3){vertex=0;removeVertex();}vertex=0;removeVertex();
            if(selected.get("points").size!=3)throw new IllegalStateException("Triangle vertex minimum failed");
            vertex=-1;
            game.world=new JsonReader().parse(undo.pop());selected=null;refresh();
            if(!baseline.equals(snapshot()))throw new IllegalStateException("Ground undo mismatch");
            JsonValue extra=new JsonReader().parse("{\"kind\":\"plaza\",\"x\":1500,\"z\":0,\"w\":40,\"d\":40}");
            game.world.get("ground").get("rectangles").addChild(extra);selected=extra;
            move(4,8);set(extra,"w",48);set(extra,"d",56);refresh();save();
            JsonValue rectangleReload=new JsonReader().parse(Files.readString(output)).get("ground").get("rectangles");
            JsonValue rectangle=rectangleReload.get(rectangleReload.size-1);
            if(rectangle.getFloat("x")!=1504||rectangle.getFloat("z")!=8||rectangle.getFloat("w")!=48||rectangle.getFloat("d")!=56)throw new IllegalStateException("Rectangle move/resize failed");
            extra.remove();selected=null;refresh();save();
            type="models";for(JsonValue e:game.world.get("models"))if(e.getString("file").equals(testFile))selected=e;
            System.out.println("Editor self-test: polygon and vertex movement, insertion/deletion, triangle minimum, save/reload, undo and rectangle move/resize passed");
            visible=true; target.set(650,450); height=1200;
            System.out.println("Editor self-test: model move, rotation and save/reload passed ("+testFile+")");
        }
    }
    private String snapshot(){return game.world.toJson(JsonWriter.OutputType.json);}
    private void remember(){undo.push(snapshot());}
    private void set(JsonValue e,String key,float value){
        if(e.has(key))e.get(key).set((double)value,null); else e.addChild(key,new JsonValue((double)value));
    }
    private void refresh() throws Exception {game.refreshModels(); if(selected==null||type.equals("ground")||type.equals("sprites"))game.refreshGround(); if(selected==null||type.equals("npcs"))game.refreshNpcs();}
    private boolean shift(){return Gdx.input.isKeyPressed(Input.Keys.SHIFT_LEFT)||Gdx.input.isKeyPressed(Input.Keys.SHIFT_RIGHT);}
    private boolean ctrl(){return Gdx.input.isKeyPressed(Input.Keys.CONTROL_LEFT)||Gdx.input.isKeyPressed(Input.Keys.CONTROL_RIGHT);}
    private boolean pressed(int k){return Gdx.input.isKeyJustPressed(k);}
    private boolean held(int k){return Gdx.input.isKeyPressed(k);}
    private Vector3 ground(int x,int y){
        Ray ray=game.camera.getPickRay(x,y); Vector3 p=new Vector3();
        return Intersector.intersectRayPlane(ray,new Plane(Vector3.Y,0),p)?p:null;
    }
    private BoundingBox bounds(JsonValue e,String kind){
        if(kind.equals("models")) {
            int i=0; for(JsonValue m:game.world.get("models")){if(m==e)break;i++;}
            return game.models.get(i).calculateBoundingBox(new BoundingBox()).mul(game.models.get(i).transform);
        }
        if(kind.equals("ground")) {
            BoundingBox b=new BoundingBox();float[] p=Ground.points(e);
            for(int i=0;i<p.length;i+=2){b.ext(p[i],1,p[i+1]);b.ext(p[i],2,p[i+1]);}return b;
        }
        float x=e.getFloat("x"),z=e.getFloat("z");
        if(kind.equals("blockers")||kind.equals("ground"))return new BoundingBox(new Vector3(x,kind.equals("ground")?1:0,z),new Vector3(x+e.getFloat("w"),kind.equals("ground")?2:22,z+e.getFloat("d")));
        float r=kind.equals("zones")?e.getFloat("radius"):10;
        return new BoundingBox(new Vector3(x-r,0,z-r),new Vector3(x+r,kind.equals("zones")?4:30,z+r));
    }
    private ArrayList<JsonValue> selectable(){
        ArrayList<JsonValue> all=new ArrayList<>();
        for(JsonValue e:game.world.get("models"))if(!e.getString("file").replace('\\','/').startsWith("maps-final/"))all.add(e);
        return all;
    }
    @Override public boolean touchDown(int x,int y,int pointer,int button){
        if(list||button!=Input.Buttons.LEFT)return false;
        selected=null;vertex=-1;
        Ray ray=game.camera.getPickRay(x,y); Vector3 hit=new Vector3(); float best=Float.MAX_VALUE;
        // Visible layout markers take priority over scenery.
        String[] kinds=visible?new String[]{"blockers","npcs","sprites","zones","ground","models"}:new String[]{"models"};
        for(String kind:kinds){
            JsonValue entries=kind.equals("ground")?game.world.get("ground").get("rectangles"):game.world.get(kind); if(entries==null)continue;
            for(JsonValue e:entries){
                if(kind.equals("models")&&e.getString("file").replace('\\','/').startsWith("maps-final/"))continue;
                if(kind.equals("ground")) {
                    Vector3 p=ground(x,y);if(p==null)continue;
                    if(!Ground.inside(e,p.x,p.z)&&nearestVertex(e,p.x,p.z,12)<0)continue;
                    hit.set(p);
                } else if(!Intersector.intersectRayBounds(ray,bounds(e,kind),hit))continue;
                if(kind.equals("zones")) {
                    Vector3 p=ground(x,y);
                    if(p==null||Vector2.dst(p.x,p.z,e.getFloat("x"),e.getFloat("z"))>e.getFloat("radius"))continue;
                }
                float distance=ray.origin.dst2(hit);
                if(distance<best){best=distance;selected=e;type=kind;}
            }
            if(selected!=null)break;
        }
        Vector3 p=ground(x,y); dragging=selected!=null&&p!=null; dragSaved=false;
        if(p!=null){lastX=p.x;lastZ=p.z;pickX=p.x;pickZ=p.z;
            if(selected!=null&&type.equals("ground")&&selected.has("points"))vertex=nearestVertex(selected,p.x,p.z,12);
        } return true;
    }
    @Override public boolean touchUp(int x,int y,int pointer,int button){if(button==Input.Buttons.LEFT)dragging=false;return false;}
    @Override public boolean touchDragged(int x,int y,int pointer){
        if(list)return false;
        try {
            if(heldButton(Input.Buttons.RIGHT)) {
                Vector3 a=ground(x-Gdx.input.getDeltaX(),y-Gdx.input.getDeltaY()),b=ground(x,y);
                if(a!=null&&b!=null)target.add(a.x-b.x,a.z-b.z);
            } else if(dragging&&selected!=null){
                Vector3 p=ground(x,y);
                if(p!=null&&(Math.abs(p.x-lastX)+Math.abs(p.z-lastZ)>.01f)){
                    if(!dragSaved){remember();dragSaved=true;}
                    move(p.x-lastX,p.z-lastZ);lastX=p.x;lastZ=p.z;
                }
            }
        }catch(Exception e){message=e.getMessage();} return true;
    }
    private boolean heldButton(int b){return Gdx.input.isButtonPressed(b);}
    @Override public boolean scrolled(float x,float y){height=MathUtils.clamp(height+y*40,100,1800);return true;}
    private void move(float x,float z)throws Exception {
        if(type.equals("ground")&&selected.has("points")) {
            int i=0;for(JsonValue v:selected.get("points")) {
                if(vertex<0||vertex==i){v.get(0).set((double)(v.getFloat(0)+x),null);v.get(1).set((double)(v.getFloat(1)+z),null);}i++;
            }
        }else{set(selected,"x",selected.getFloat("x")+x);set(selected,"z",selected.getFloat("z")+z);}refresh();
    }
    private int nearestVertex(JsonValue e,float x,float z,float radius) {
        float[] p=Ground.points(e);int best=-1;float distance=radius*radius;
        for(int i=0;i<p.length;i+=2){float d=Vector2.dst2(x,z,p[i],p[i+1]);if(d<distance){distance=d;best=i/2;}}return best;
    }
    private void insertVertex() {
        JsonValue points=selected.get("points");int nearest=nearestVertex(selected,pickX,pickZ,Float.MAX_VALUE);
        JsonValue a=points.get(nearest),b=points.get((nearest+1)%points.size);
        JsonValue added=new JsonValue(JsonValue.ValueType.array);
        added.addChild(new JsonValue((a.getFloat(0)+b.getFloat(0))/2.0));added.addChild(new JsonValue((a.getFloat(1)+b.getFloat(1))/2.0));
        ArrayList<JsonValue> values=new ArrayList<>();for(JsonValue v:points)values.add(v);
        while(points.size>0)points.get(0).remove();
        for(int i=0;i<values.size();i++){points.addChild(values.get(i));if(i==nearest)points.addChild(added);}vertex=nearest+1;
    }
    private void removeVertex(){JsonValue p=selected.get("points");if(p.size>3){p.get(vertex).remove();vertex=-1;}}
    private void outline(JsonValue e){
        float[] p=Ground.points(e);
        for(int i=0;i<p.length;i+=2){int j=(i+2)%p.length;shapes.line(p[i],3,p[i+1],p[j],3,p[j+1]);
            if(e.has("points")){float r=e==selected&&vertex==i/2?8:5;shapes.box(p[i]-r,3,p[i+1]+r,r*2,3,r*2);}}
    }
    void update(float dt)throws Exception {
        if(list){
            if(pressed(Input.Keys.ESCAPE))list=false;
            else if(!files.isEmpty()){
                if(pressed(Input.Keys.UP))choice=Math.floorMod(choice-1,files.size());
                if(pressed(Input.Keys.DOWN))choice=(choice+1)%files.size();
                if(pressed(Input.Keys.ENTER)){
                    remember(); selected=new JsonValue(JsonValue.ValueType.object);type="models";
                    selected.addChild("file",new JsonValue(files.get(choice)));set(selected,"x",target.x);set(selected,"z",target.y);
                    game.world.get("models").addChild(selected);refresh();list=false;
                }
            }
        }else{
            if(pressed(Input.Keys.ESCAPE))Gdx.app.exit();
            if(pressed(Input.Keys.B))visible=!visible;
            if(ctrl()&&pressed(Input.Keys.S))save();
            if(ctrl()&&pressed(Input.Keys.Z)&&!undo.isEmpty()){
                game.world=new JsonReader().parse(undo.pop());selected=null;dragging=false;refresh();
            }
            if(pressed(Input.Keys.N))list=true;
            if(pressed(Input.Keys.TAB)){
                ArrayList<JsonValue> all=selectable();
                if(!all.isEmpty()){int i=all.indexOf(selected);selected=all.get(i<0?(shift()?all.size()-1:0):Math.floorMod(i+(shift()?-1:1),all.size()));type="models";}
            }
            if(pressed(Input.Keys.INSERT)&&!held(Input.Keys.G)&&selected!=null&&type.equals("ground")&&selected.has("points")) {
                Vector3 cursor=ground(Gdx.input.getX(),Gdx.input.getY());if(cursor!=null){pickX=cursor.x;pickZ=cursor.z;}
                remember();insertVertex();refresh();
            }else if(pressed(Input.Keys.INSERT)){
                remember();selected=new JsonValue(JsonValue.ValueType.object);type=held(Input.Keys.G)?"ground":"blockers";visible=true;if(type.equals("ground"))selected.addChild("kind",new JsonValue("plaza"));
                set(selected,"x",target.x);set(selected,"z",target.y);set(selected,"w",40);set(selected,"d",40);
                (type.equals("ground")?game.world.get("ground").get("rectangles"):game.world.get("blockers")).addChild(selected);refresh();
            }
            if(selected!=null){
                if(pressed(Input.Keys.DEL)){remember();
                    if(type.equals("ground")&&selected.has("points")&&vertex>=0)removeVertex();
                    else {selected.remove();selected=null;}refresh();}
                else if(ctrl()&&pressed(Input.Keys.D)&&(type.equals("models")||type.equals("sprites"))){
                    remember();JsonValue copy=new JsonReader().parse(selected.toJson(JsonWriter.OutputType.json));
                    game.world.get(type).addChild(copy);selected=copy;move(20,20);
                }else if(ctrl()){
                    float n=shift()?8:1;
                    float x=(pressed(Input.Keys.RIGHT)?n:0)-(pressed(Input.Keys.LEFT)?n:0);
                    float z=(pressed(Input.Keys.DOWN)?n:0)-(pressed(Input.Keys.UP)?n:0);
                    if(x!=0||z!=0){remember();move(x,z);}
                }else{
                    String field=null;float delta=0,min=-Float.MAX_VALUE;
                    if(type.equals("models")){
                        if(pressed(Input.Keys.Q)||pressed(Input.Keys.E)){field="rotY";delta=(pressed(Input.Keys.Q)?-1:1)*(shift()?1:15);}
                        if(pressed(Input.Keys.PLUS)||pressed(Input.Keys.EQUALS)||pressed(Input.Keys.NUMPAD_ADD)){field="scale";delta=.05f;min=.1f;}
                        if(pressed(Input.Keys.MINUS)||pressed(Input.Keys.NUMPAD_SUBTRACT)){field="scale";delta=-.05f;min=.1f;}
                    }else if(type.equals("blockers")||(type.equals("ground")&&!selected.has("points"))||type.equals("zones")){
                        if(pressed(Input.Keys.LEFT_BRACKET)||pressed(Input.Keys.RIGHT_BRACKET)){
                            field=type.equals("zones")?"radius":"w";delta=(pressed(Input.Keys.LEFT_BRACKET)?-1:1)*(shift()?1:8);min=1;
                        }
                        if((type.equals("blockers")||type.equals("ground"))&&(pressed(Input.Keys.SEMICOLON)||pressed(Input.Keys.APOSTROPHE))){field="d";delta=(pressed(Input.Keys.SEMICOLON)?-1:1)*(shift()?1:8);min=1;}
                    }
                    if(field!=null){remember();set(selected,field,Math.max(min,selected.getFloat(field,field.equals("scale")?1:0)+delta));refresh();}
                }
            }
            if(!ctrl()){
                float speed=height*dt*.6f;
                target.add(((held(Input.Keys.D)||held(Input.Keys.RIGHT))?speed:0)-((held(Input.Keys.A)||held(Input.Keys.LEFT))?speed:0),
                    ((held(Input.Keys.S)||held(Input.Keys.DOWN))?speed:0)-((held(Input.Keys.W)||held(Input.Keys.UP))?speed:0));
            }
        }
        game.camera.position.set(target.x,height,target.y+height);game.camera.up.set(Vector3.Y);
        game.camera.far=6000;game.camera.lookAt(target.x,0,target.y);game.camera.update();
    }
    private void round(JsonValue e){
        if(e.isNumber())e.set(Math.round(e.asDouble()*10)/10.0,null);
        for(JsonValue child=e.child;child!=null;child=child.next)round(child);
    }
    private void save()throws Exception {
        JsonValue copy=new JsonReader().parse(snapshot());round(copy);
        String text=copy.prettyPrint(JsonWriter.OutputType.json,0)+"\n";
        Files.copy(output,output.resolveSibling("world.json.bak"),StandardCopyOption.REPLACE_EXISTING);
        Path temp=output.resolveSibling("world.json.tmp");Files.writeString(temp,text);
        Files.move(temp,output,StandardCopyOption.REPLACE_EXISTING);
        saved=snapshot();message="Saved "+output;
    }
    private void box(BoundingBox b){shapes.box(b.min.x,b.min.y,b.max.z,b.getWidth(),b.getHeight(),b.getDepth());}
    void draw(){
        shapes.setProjectionMatrix(game.camera.combined);
        Gdx.gl.glEnable(GL20.GL_DEPTH_TEST);Gdx.gl.glEnable(GL20.GL_BLEND);Gdx.gl.glBlendFunc(GL20.GL_SRC_ALPHA,GL20.GL_ONE_MINUS_SRC_ALPHA);
        Gdx.gl.glDepthMask(false);
        if(visible){
            shapes.begin(ShapeRenderer.ShapeType.Filled);shapes.setColor(1,.25f,.15f,.22f);
            for(JsonValue e:game.world.get("blockers"))box(bounds(e,"blockers"));shapes.end();
            shapes.begin(ShapeRenderer.ShapeType.Line);
            shapes.setColor(1,.4f,.2f,1);for(JsonValue e:game.world.get("blockers"))box(bounds(e,"blockers"));
            shapes.setColor(.3f,1,.3f,1);for(JsonValue e:game.world.get("ground").get("rectangles"))outline(e);
            shapes.setColor(.2f,1,1,1);
            for(JsonValue e:game.world.get("zones")){
                float r=e.getFloat("radius"),x=e.getFloat("x"),z=e.getFloat("z");
                for(int i=0;i<64;i++){float a=i*MathUtils.PI2/64,b=(i+1)*MathUtils.PI2/64;shapes.line(x+r*MathUtils.cos(a),3,z+r*MathUtils.sin(a),x+r*MathUtils.cos(b),3,z+r*MathUtils.sin(b));}
            }
            shapes.setColor(.7f,.4f,1,1);JsonValue entries=game.world.get("npcs");if(entries!=null)for(JsonValue e:entries)box(bounds(e,"npcs"));
            shapes.setColor(.3f,.8f,.3f,1);JsonValue scenery=game.world.get("sprites");if(scenery!=null)for(JsonValue e:scenery)box(bounds(e,"sprites"));
            shapes.end();
        }
        if(selected!=null){Gdx.gl.glDisable(GL20.GL_DEPTH_TEST);shapes.begin(ShapeRenderer.ShapeType.Line);shapes.setColor(Color.YELLOW);if(type.equals("ground"))outline(selected);else box(bounds(selected,type));shapes.end();}
        Gdx.gl.glDepthMask(true);Gdx.gl.glDisable(GL20.GL_BLEND);Gdx.gl.glDisable(GL20.GL_DEPTH_TEST);
    }
    void hud(SpriteBatch ui,BitmapFont font){
        float y=Gdx.graphics.getHeight()-22;
        font.setColor(Color.WHITE);font.draw(ui,"LAYOUT EDITOR  /  "+(!saved.equals(snapshot())?"unsaved changes (Esc loses changes)":"saved"),20,y);
        String info="No selection";
        if(selected!=null){
            info=type+" / "+selected.getString("file",selected.getString("name","rectangle"))+String.format(Locale.ROOT,"  x %.1f z %.1f",selected.getFloat("x",type.equals("ground")?Ground.points(selected)[0]:0),selected.getFloat("z",0));
            if(type.equals("models"))info+=String.format(Locale.ROOT,"  rotY %.1f scale %.2f",selected.getFloat("rotY",0),selected.getFloat("scale",1));
            if(type.equals("blockers")||(type.equals("ground")&&!selected.has("points")))info+=String.format(Locale.ROOT,"  w %.1f d %.1f",selected.getFloat("w"),selected.getFloat("d"));
            if(type.equals("zones"))info+="  radius "+selected.getFloat("radius");
        }
        font.draw(ui,info,20,y-28);font.draw(ui,message,20,58);
        font.getData().setScale(.9f);
        font.draw(ui,"WASD/arrows/RMB: pan  Wheel: zoom  Click/Tab: select  Drag/Ctrl+arrows: move  Q/E: rotate  +/-: scale  N: add  B: markers  Ins/Del  Ctrl+D/S/Z  Esc: quit",12,25);
        font.getData().setScale(1.25f);
        if(list){
            font.setColor(Color.YELLOW);font.draw(ui,"ADD MODEL: Up/Down, Enter to place, Esc to close",20,y-75);
            if(files.isEmpty())font.draw(ui,"No .glb files found",20,y-110);
            int start=Math.max(0,Math.min(choice-8,files.size()-16));
            for(int i=start;i<Math.min(files.size(),start+16);i++)font.draw(ui,(i==choice?"> ":"  ")+files.get(i),20,y-110-(i-start)*26);
        }
    }
    void afterRender()throws Exception {
        if(selftest&&++frames==30){
            Pixmap shot=Pixmap.createFromFrameBuffer(0,0,Gdx.graphics.getWidth(),Gdx.graphics.getHeight());
            PixmapIO.writePNG(Gdx.files.absolute(output.resolveSibling("editor.png").toString()),shot,-1,true);shot.dispose();Gdx.app.exit();
        }
    }
    void dispose(){Gdx.input.setInputProcessor(null);shapes.dispose();}
}
