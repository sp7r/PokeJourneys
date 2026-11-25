package journeys.hub.game;

import android.os.Bundle;
import com.badlogic.gdx.backends.android.AndroidApplication;
import com.badlogic.gdx.backends.android.AndroidApplicationConfiguration;
import java.io.File;
import java.nio.file.Path;

/**
 * Starts the hub on Android. The game data (the exported island, textures, models, character sheets and config) is
 * not in the APK: it lives in this app's private storage, files/data, copied there by tools/hub/android-data.js for
 * now and later written by the app's ROM import. Without it the hub says where the data should be.
 */
public final class AndroidLauncher extends AndroidApplication {
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        File base = getFilesDir();
        Path root = base.toPath(), data = root.resolve("data"), work = root.resolve("work");
        work.toFile().mkdirs();
        // the hub keeps every file inside the data folder by comparing real paths, and /data/user/0 is a link to /data/data
        try { root = root.toRealPath(); data = root.resolve("data"); work = root.resolve("work"); } catch (java.io.IOException ignored) { }
        AndroidApplicationConfiguration c = new AndroidApplicationConfiguration();
        c.useImmersiveMode = true;
        c.useGL30 = true;
        c.depth = 24;
        c.useAccelerometer = false;
        c.useCompass = false;
        initialize(new HubGame(data, work, data.resolve("config"), data.resolve("art"), false, false, false, false), c);
    }
}
