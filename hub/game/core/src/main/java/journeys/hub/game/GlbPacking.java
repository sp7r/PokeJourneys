package journeys.hub.game;
import java.nio.*;
import java.nio.file.*;
import java.io.*;
import com.badlogic.gdx.utils.*;
final class GlbPacking {
    // Some exporters emit GLB geometry with external PNGs. Embed those for the GLB loader.
    static Path pack(Path file, Path output) throws Exception {
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
        Path packed=output.resolve("packed").resolve(file.getParent().getFileName()+"-"+file.getFileName());Files.createDirectories(packed.getParent());Files.write(packed,result.array());return packed;
    }

}
