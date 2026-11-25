package com.pokedaisy.app.journeys

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.view.KeyEvent
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import com.pokedaisy.app.Prefs
import java.io.File
import kotlin.concurrent.thread

/**
 * First run of the hub: builds Victory Island's data (the island, its rooms, the game interfaces) from the player's own
 * cartridges, with the same scripts the PC uses (tools/hub, in the APK as assets under hub-build/) run by QuickJS
 * (libqjs.so) and apicula (libapicula.so). Nothing from the games ships with the app. Needs FireRed (Rev 1),
 * HeartGold, Platinum, Black and Black 2 in the library; guides the player through setup. Opens the hub when done.
 */
class HubBuildActivity : ComponentActivity() {

    private lateinit var screen: FireRedScreen
    private lateinit var setup: HubSetup
    @Volatile private var running = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // a sleeping screen would let Android pause the build
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        screen = FireRedScreen(this, File(HubActivity.dataDir(this), "ui/firered"))
        setContentView(screen)
        setup = HubSetup(this, screen, ::start)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (setup.active) setup.back() else if (!running) finish()
            }
        })
        setup.show(savedInstanceState)
    }

    override fun onResume() { super.onResume(); if (::setup.isInitialized) setup.onResume() }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        setup.onPermissionsResult()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        setup.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (setup.active && setup.handlesKey(keyCode)) return true
        return super.onKeyDown(keyCode, event)
    }

    // A, Start or Enter answer the blinking arrow, as a tap does
    override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
        if (setup.onKeyUp(keyCode)) return true
        if (keyCode in listOf(KeyEvent.KEYCODE_BUTTON_A, KeyEvent.KEYCODE_BUTTON_START, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_DPAD_CENTER)) {
            screen.answer(); return true
        }
        return super.onKeyUp(keyCode, event)
    }

    private fun start(roms: Map<String, File>) {
        if (running) return
        val prefs = Prefs(this)
        screen.title = "Building Victory Island"; screen.lines = emptyList(); screen.progress = null; screen.onA = null
        screen.message = "Looking for your cartridges…"
        running = true
        thread(name = "pokejourneys-hub-build") {
            // the hub's trainer card is drawn from PokeDaisy's FireRed art, which is otherwise only scanned when FireRed is played
            com.pokedaisy.app.companion.data.RomArt.prefetch(filesDir, "hub-firered", roms.getValue("firered"))
            runOnUiThread { screen.message = "This only happens once." }
            val ok = runCatching { build(roms) }.onFailure { Log.e(TAG, "hub build failed", it) }
            running = false
            runOnUiThread {
                if (ok.getOrNull() == true && ready(this)) {
                    HubActivity.open(this, prefs); finish()
                } else {
                    screen.title = "The build stopped."; screen.progress = null
                    screen.lines = listOf((ok.exceptionOrNull()?.message ?: lastLine).take(200))
                    screen.message = "Something went wrong. Press A to try again."
                    screen.onA = { setup.checkAgain() }
                }
            }
        }
    }

    @Volatile private var lastLine = ""

    /**
     * Runs hub-build.js and, at the same time, the rooms (HubRooms, much faster here than in the phone's JavaScript
     * engine) and the music (HubMusic); true when all finished. hub-build.js's "STEP i/n name" lines move the bar.
     * build.json is written last.
     */
    private fun build(roms: Map<String, File>): Boolean {
        val tools = File(filesDir, "hub-build")
        tools.deleteRecursively()
        copyAssets("hub-build", tools)
        val work = File(cacheDir, "hub-build-work")
        val lib = applicationInfo.nativeLibraryDir
        val data = HubActivity.dataDir(this)
        File(data, "build.json").delete()
        var roomsError: Throwable? = null
        val rooms = thread(name = "pokejourneys-hub-rooms") {
            runCatching {
                HubRooms.build(roms, File(tools, "tools/hub/build/rooms.json"), File(tools, "tools/hub/victory/heights.js"),
                    File(lib, "libapicula.so"), data, File(cacheDir, "hub-rooms-work")) { Log.i(TAG, "hub rooms: $it") }
            }.onFailure { roomsError = it; Log.e(TAG, "hub rooms failed", it) }
        }
        var musicError: Throwable? = null
        val music = thread(name = "pokejourneys-hub-music") {
            runCatching { HubMusic.build(roms, data) { Log.i(TAG, "hub music: $it") } }
                .onFailure { musicError = it; Log.e(TAG, "hub music failed", it) }
        }
        val scripts = runScripts(tools, lib, data, work, roms)
        rooms.join(); music.join()
        roomsError?.let { throw it }
        musicError?.let { throw it }
        if (!scripts) return false
        File(data, "build.json").writeText("{\"version\":$BUILD_VERSION,\"built\":\"${java.time.Instant.now()}\"}\n")
        return true
    }

    private fun runScripts(tools: File, lib: String, data: File, work: File, roms: Map<String, File>): Boolean {
        val command = mutableListOf(
            File(lib, "libqjs.so").path, File(tools, "tools/hub/qjs/node.mjs").path, File(tools, "tools/hub/build/hub-build.js").path,
            "--apicula", File(lib, "libapicula.so").path, "--data", data.path, "--work", work.path, "--app-rooms", "1"
        )
        for ((game, file) in roms) command += listOf("--$game", file.path)
        val process = ProcessBuilder(command).directory(tools).redirectErrorStream(true)
            .also { it.environment()["TMPDIR"] = cacheDir.path }.start()
        process.outputStream.close()
        process.inputStream.bufferedReader().forEachLine { line ->
            Log.i(TAG, "hub build: $line")
            lastLine = line
            val step = STEP.find(line)
            if (step != null) {
                val (i, n, name) = step.destructured
                runOnUiThread {
                    screen.reload() // FireRed's own windows and font, once step 2 has made them
                    screen.progress = (i.toInt() - 1) / n.toFloat()
                    screen.lines = listOf((STEP_NAMES[name] ?: name) + "…", "Step $i of $n")
                    if (i == "1") showTips()
                }
            }
        }
        return process.waitFor() == 0
    }

    /** A fun fact or trainer tip in the message box, a new one every few seconds while the build runs. */
    private fun showTips() {
        var next = TIPS.indices.random()
        val show = object : Runnable {
            override fun run() {
                if (!running || isFinishing) return
                screen.message = TIPS[next % TIPS.size]; next++
                screen.postDelayed(this, 6000)
            }
        }
        show.run()
    }

    private fun copyAssets(path: String, to: File) {
        val children = assets.list(path).orEmpty()
        if (children.isEmpty()) { to.parentFile?.mkdirs(); assets.open(path).use { input -> to.outputStream().use { input.copyTo(it) } }; return }
        to.mkdirs()
        for (child in children) copyAssets("$path/$child", File(to, child))
    }

    companion object {
        private const val TAG = "pokejourneys"
        /** tools/hub/build/hub-build.js VERSION: a phone whose data is older builds again. */
        const val BUILD_VERSION = 4
        private val STEP = Regex("^STEP (\\d+)/(\\d+) (\\S+)")
        private val STEP_NAMES = mapOf(
            "extract" to "Unpacking the DS cartridges", "firered-ui" to "Painting FireRed's menus", "battle-ui" to "Setting up the battle screen",
            "naming" to "Borrowing Platinum's keyboard", "captain" to "Hiring the ferry captain", "backdrops" to "Hanging battle backdrops",
            "island" to "Raising Victory Island", "frames" to "Waking up the townsfolk", "rooms-platinum" to "Furnishing Platinum's rooms",
            "rooms-heartgold" to "Furnishing HeartGold's rooms", "rooms-black2" to "Furnishing Black 2's rooms", "finish" to "Final touches"
        )
        /** Short enough for the message box's two lines. */
        private val TIPS = listOf(
            "FireRed and LeafGreen remade the first Pokémon games in 2004.",
            "FireRed's Sevii Islands lie south of Kanto, past Cinnabar.",
            "In HeartGold, any Pokémon can follow you around.",
            "HeartGold has two whole regions: Johto, then Kanto.",
            "The Pokéwalker let you take a Pokémon on a real walk.",
            "Giratina waits in Platinum's Distortion World.",
            "Platinum brought the Battle Frontier to Sinnoh.",
            "Unova is based on New York City and its surroundings.",
            "Black and White showed only new Pokémon until the story ended.",
            "Black 2 and White 2 were the series' first direct sequels.",
            "Black 2's Pokéstar Studios let you star in your own movies.",
            "Trainer tip: a Pokémon low on HP is easier to catch.",
            "Trainer tip: sleep or paralysis makes a catch more likely.",
            "Trainer tip: Electric moves can't touch Ground types.",
            "Trainer tip: Normal and Ghost moves can't hit each other.",
            "Trainer tip: a super effective move does double damage.",
            "Victory Island is built from the cartridges you own."
        )

        /** Whether the hub data on the device was built by this version of the build. */
        fun ready(context: Context): Boolean = runCatching {
            Regex("\"version\":(\\d+)").find(File(HubActivity.dataDir(context), "build.json").readText())?.groupValues?.get(1)?.toInt() == BUILD_VERSION
        }.getOrDefault(false)

        /** The five header versions, with archives opened as files for the builder. */
        fun findRoms(context: Context, prefs: Prefs): Map<String, File> = HubSetup.findRoms(context, prefs)

        fun open(from: Activity) = from.startActivity(Intent(from, HubBuildActivity::class.java))
    }
}
