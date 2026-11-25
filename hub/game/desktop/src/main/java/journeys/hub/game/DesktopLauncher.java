package journeys.hub.game;

import com.badlogic.gdx.backends.lwjgl3.*;
import java.nio.file.*;

public final class DesktopLauncher {
    public static void main(String[] args) throws Exception {
        Path data = null, config = Path.of("config"), art = Path.of("../../assets/creator");
        boolean review = false, tour = false, edit = false, editSelftest = false;
        String playShot = null;
        for (int i=0;i<args.length;i++) {
            switch(args[i]) {
                case "--data": data=Path.of(args[++i]); break;
                case "--config": config=Path.of(args[++i]); break;
                case "--art": art=Path.of(args[++i]); break;
                case "--review": review=true; break;
                case "--tour": tour=true; break;
                case "--edit": edit=true; break;
                case "--edit-selftest": edit=true; editSelftest=true; break;
                case "--play-shot": playShot=args[++i]; break;
                default: throw new IllegalArgumentException("Unknown argument: "+args[i]);
            }
        }
        if(data==null) {
            System.err.println("Game data missing. Use --data PATH to your converted ROM data under C:/Projects/hub-work. See hub/README.md.");
            System.exit(2);
        }
        Path work=Path.of("C:/Projects/hub-work").toRealPath();
        data=data.toRealPath();
        if(!data.startsWith(work)) throw new IllegalArgumentException("Game data must be outside the repository, under "+work);
        var c=new Lwjgl3ApplicationConfiguration();
        c.setTitle("PokeJourneys | PWT Hub"); c.setWindowedMode(1100,760);
        if((review?1:0)+(tour?1:0)+(edit?1:0)>1) throw new IllegalArgumentException("Use only one of --review, --tour or --edit");
        boolean auto=review||tour;
        c.setBackBufferConfig(8,8,8,8,24,0,0);
        c.disableAudio(true); c.useVsync(!auto); c.setForegroundFPS(auto?0:60);
        HubGame game=new HubGame(data,work,config.toRealPath(),art.toRealPath(),review,tour,edit,editSelftest);
        game.playShot=playShot;
        new Lwjgl3Application(game,c);
        if(game.failed) System.exit(1);
    }
}
