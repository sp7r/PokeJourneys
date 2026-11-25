package com.pokedaisy.app.journeys

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.drawable.BitmapDrawable
import android.util.DisplayMetrics
import android.util.AtomicFile
import android.util.Log
import android.view.Display
import android.view.MotionEvent
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import androidx.compose.runtime.mutableStateOf
import com.pokedaisy.app.DualScreenPresentation
import com.pokedaisy.app.GameTitles
import com.pokedaisy.app.Prefs
import com.pokedaisy.app.RomCategory
import com.pokedaisy.app.RomIdentity
import com.pokedaisy.app.RomFolder
import com.pokedaisy.app.Screens
import com.pokedaisy.app.companion.i18n.L10n
import com.pokedaisy.app.companion.i18n.tr
import org.godotengine.godot.Godot
import org.godotengine.godot.GodotActivity
import org.godotengine.godot.plugin.GodotPlugin
import org.godotengine.godot.plugin.SignalInfo
import org.godotengine.godot.plugin.UsedByGodot
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.concurrent.thread

/**
 * Victory Island (hub/victory, a Godot project packed into the APK's assets by app/build.gradle.kts).
 *
 * It runs in its own process (":hub" in the manifest): Godot ends its process when it quits and can start only once
 * per process. So it writes none of the app's settings; the main process writes `journeys.json` ([open]) and starts
 * the games ([JourneyLaunchActivity]).
 *
 * The island's models and textures come from the player's games and never ship in the APK: they're read from
 * [dataDir], the folder `node tools/hub/victory/export.js` writes, copied to the device.
 */
class HubActivity : GodotActivity() {

    override fun getCommandLine(): MutableList<String> =
        (super.getCommandLine() + listOf("--", "--data=${dataDir(this).absolutePath}", "--creator-art=res://creator"))
            .toMutableList()

    override fun getHostPlugins(godot: Godot): MutableSet<GodotPlugin> = mutableSetOf(Plugin(godot, this))

    /** The hub's `Engine.get_singleton("PokeJourneys")` (hub/victory/scripts/main.gd, creator.gd). */
    class Plugin(godot: Godot, private val hub: Activity) : GodotPlugin(godot) {
        override fun getPluginName() = "PokeJourneys"

        override fun getPluginSignals(): MutableSet<SignalInfo> = mutableSetOf(
            SignalInfo("bottom_touch", Int::class.javaObjectType, Int::class.javaObjectType),
            SignalInfo("follower_ready", Int::class.javaObjectType, ByteArray::class.java, String::class.java),
            SignalInfo("weekly_sighting_ready", String::class.java),
            SignalInfo("shop_ready", String::class.java),
            SignalInfo("signed_in", String::class.java),
            SignalInfo("sign_in_failed", String::class.java),
            SignalInfo("live_ready", String::class.java, String::class.java, String::class.java),
            SignalInfo("remote_follower_ready", Int::class.javaObjectType, ByteArray::class.java),
            SignalInfo("card_ready", Int::class.javaObjectType, ByteArray::class.java),
        )

        /** Answers card_ready(request, png): another player's trainer card (HubCompanion.otherCard), empty without art. */
        @UsedByGodot
        fun player_card(requestId: Int, player: String) {
            thread(name = "pokejourneys-player-card") {
                val png = runCatching { HubCompanion.otherCard(hub, JSONObject(player)) }.getOrElse { error ->
                    Log.w(TAG, "couldn't draw a player's trainer card", error)
                    ByteArray(0)
                }
                runOnRenderThread { emitSignal("card_ready", requestId, png) }
            }
        }

        // Other players in the hub (the hub's others.gd, the server's live connection).

        /** Answers live_ready(url, token, message): the selected server's live address, or why there is none. */
        @UsedByGodot
        fun live_connect() {
            thread(name = "pokejourneys-live") {
                // A newer release on the server has to be installed first: the server would refuse this version anyway.
                if (UpdateRequiredActivity.needed()) UpdateRequiredActivity.open(hub)
                val answer = runCatching { JourneyServer.selected(hub)?.live() }
                if ((answer.exceptionOrNull() as? JourneyServer.Failure)?.status == 426) UpdateRequiredActivity.open(hub)
                // The server's wallet and bag win: bring them onto the phone each time the island connects.
                if (answer.getOrNull() != null) runCatching { ServerWallet.refresh(hub) }
                // The bottom screen's card waits for this: signed in, and the trainer fetched from the server.
                val waiting = when {
                    answer.getOrNull() != null -> ""
                    answer.isSuccess -> tr("NO SERVER CHOSEN")
                    else -> tr("NOT CONNECTED TO THE SERVER")
                }
                hub.runOnUiThread {
                    serverWaiting = waiting
                    refreshTrainer()
                }
                runOnRenderThread {
                    val live = answer.getOrNull()
                    when {
                        live != null -> emitSignal("live_ready", live.first, live.second, "")
                        answer.isSuccess -> emitSignal("live_ready", "", "", tr("No server chosen; other players show when you pick one in Settings."))
                        else -> emitSignal("live_ready", "", "", answer.exceptionOrNull()?.message.orEmpty())
                    }
                }
            }
        }

        /** Answers remote_follower_ready(request, png): another player's follower sheet, empty when there's no art. */
        @UsedByGodot
        fun remote_follower(requestId: Int, species: Int, shiny: Boolean) {
            thread(name = "pokejourneys-remote-follower") {
                val sheet = if (species in 1..1025) runCatching { HubFollower.sheetFor(hub, species, shiny) }.getOrDefault(ByteArray(0)) else ByteArray(0)
                runOnRenderThread { emitSignal("remote_follower_ready", requestId, sheet) }
            }
        }

        // Discord sign-in (DiscordSignIn.kt, the hub's signin.gd).

        @UsedByGodot
        fun sign_in_available(): Boolean = DiscordSignIn.available()

        /** The signed-in player's Discord name, or "" for nobody. */
        @UsedByGodot
        fun account_name(): String = DiscordSignIn.account(hub)?.name.orEmpty()

        /** The signed-in player's Discord id, or "" for nobody: the hub keeps each account's files apart. */
        @UsedByGodot
        fun account_id(): String = DiscordSignIn.account(hub)?.id.orEmpty()

        @UsedByGodot
        fun sign_in() {
            DiscordSignIn.listener = { account, message ->
                runOnRenderThread {
                    if (account != null) emitSignal("signed_in", account.name) else emitSignal("sign_in_failed", message)
                }
                hub.runOnUiThread { refreshTrainer() }
            }
            hub.runOnUiThread { DiscordSignIn.start(hub) }
        }

        /** The journey the ship's captain sails to: its ROM path, from journeys.json. */
        @UsedByGodot
        fun launch(rom: String) {
            hub.runOnUiThread {
                JourneyLaunchActivity.start(hub, File(rom))
            }
        }

        /** The Vault, opened by the PokeVault's clerk. */
        @UsedByGodot
        fun open_vault() {
            hub.runOnUiThread { openPage(HubPageActivity.PAGE_VAULT) }
        }

        /** The app's settings, opened by the hub companion's SETTINGS button or by Trainer Services. */
        @UsedByGodot
        fun open_settings() {
            hub.runOnUiThread { openPage(HubPageActivity.PAGE_SETTINGS) }
        }

        @UsedByGodot
        fun open_bot_battle(mode: String) {
            hub.runOnUiThread { BattleDomeActivity.start(hub, mode) }
        }

        @UsedByGodot
        fun open_pvp_battle(json: String) {
            hub.runOnUiThread { BattleDomeActivity.start(hub, "pvp", json) }
        }

        private var loadedFollower: Pair<Int, HubFollower.Identity>? = null

        @UsedByGodot
        fun request_follower(requestId: Int) {
            thread(name = "pokejourneys-follower") {
                val follower = runCatching { HubFollower.load(hub) }.getOrElse { error ->
                    Log.w(TAG, "couldn't load the hub follower", error)
                    HubFollower.Asset(message = tr("Couldn't load your follower."))
                }
                runOnRenderThread {
                    loadedFollower = follower.identity?.let { requestId to it }
                    emitSignal("follower_ready", requestId, follower.sheet, follower.message)
                }
            }
        }

        @UsedByGodot
        fun weekly_sighting(visibleFollowerRequest: Int) {
            val active = loadedFollower?.takeIf { it.first == visibleFollowerRequest }?.second
            thread(name = "pokejourneys-weekly-sighting") {
                val pages = runCatching { WeeklySighting.speak(hub, active) }.getOrElse { error ->
                    Log.w(TAG, "couldn't read the weekly sighting", error)
                    JSONArray(listOf(tr("I can't open my journal right now. Please try again."))).toString()
                }
                runOnRenderThread { emitSignal("weekly_sighting_ready", pages) }
            }
        }

        @UsedByGodot
        fun shop_request(action: String, shop: String, destination: String, item: String, quantity: Int) {
            thread(name = "pokejourneys-shop") {
                val response = runCatching { HubEconomy.shop(hub, action, shop, destination, item, quantity) }
                    .getOrElse { error ->
                        Log.w(TAG, "couldn't load the shop", error)
                        HubEconomy.failure(tr("The shop is unavailable. Please try again."))
                    }
                runOnRenderThread { emitSignal("shop_ready", response) }
                if (action != "list" || destination.isEmpty()) hub.runOnUiThread { refreshTrainer() }
            }
        }

        private var pageDisplayId: Int? = null
        private var hubResumed = false
        private var topPageVisible = false

        private fun openPage(page: String) {
            if (pageDisplayId != null) return
            val second = if (HubPageActivity.onTop(hub)) null else Screens.second(hub)
            pageDisplayId = second?.displayId ?: Display.DEFAULT_DISPLAY
            // Keep the card through the hub's pause while a top-screen page starts.
            topPageVisible = second == null
            // The Presentation sits above activities on that display, even while the island keeps running.
            if (second != null) closeBottom()
            HubPageActivity.start(hub, page, second, onTopVisibilityChanged = { visible ->
                pageDisplayId = Display.DEFAULT_DISPLAY
                topPageVisible = visible
                updateBottom()
            }) {
                pageDisplayId = null
                topPageVisible = false
                updateBottom()
            }
        }

        /** One screen: the hub companion's window, from the hot wheel's CARD. Two screens show it already. */
        @UsedByGodot
        fun open_companion() {
            hub.runOnUiThread { if (Screens.second(hub) == null) openWindow() }
        }

        /** Swaps the screen the Vault and the settings open on (the hot wheel's SWAP, R3): "top" or "bottom", as it is now. */
        @UsedByGodot
        fun swap_pages(): String {
            val top = !HubPageActivity.onTop(hub)
            HubPageActivity.setOnTop(hub, top)
            return if (top) "top" else "bottom"
        }

        // The bottom screen. It shows the hub companion (HubCompanion.kt). Godot draws only to the top screen, so a
        // screen the hub draws off-screen (the creator's buttons) comes here as a PNG and covers the companion until
        // the hub hides it; a touch on it goes back as bottom_touch(x, y) in that image's pixels. Not focusable, so
        // the buttons stay with the top screen.

        private var bottom: DualScreenPresentation? = null
        private var bottomView: ImageView? = null
        private var picture: Bitmap? = null
        private val trainer = mutableStateOf(HubCompanion.Trainer())

        /** Why the card isn't shown yet ("" once the island is connected); live_connect sets it. UI thread only. */
        private var serverWaiting = tr("CONNECTING TO THE SERVER...")

        /** Reads the trainer again off the UI thread (the card is drawn there too). */
        private fun refreshTrainer() {
            val waiting = serverWaiting
            thread(name = "pokejourneys-trainer") {
                val read = HubCompanion.trainer(hub, waiting)
                hub.runOnUiThread { trainer.value = read }
            }
        }

        @UsedByGodot
        fun has_second_screen(): Boolean = Screens.second(hub) != null

        /** The second screen's size in pixels: [width, height], or [0, 0] without one. */
        @UsedByGodot
        fun second_screen_size(): IntArray {
            val display = Screens.second(hub) ?: return intArrayOf(0, 0)
            val metrics = DisplayMetrics()
            @Suppress("DEPRECATION") display.getRealMetrics(metrics)
            return intArrayOf(metrics.widthPixels, metrics.heightPixels)
        }

        @UsedByGodot
        fun show_bottom(png: ByteArray) {
            val bitmap = BitmapFactory.decodeByteArray(png, 0, png.size) ?: return
            hub.runOnUiThread {
                picture = bitmap
                showPicture()
            }
        }

        @UsedByGodot
        fun hide_bottom() {
            hub.runOnUiThread {
                picture = null
                bottomView?.visibility = View.GONE
                // The creator may have just changed the trainer.
                refreshTrainer()
            }
        }

        /** Opens the bottom screen with the companion, and over it the (hidden) view for the hub's own pictures. */
        private fun openBottom() {
            if ((!hubResumed && !topPageVisible) || hub.isFinishing || hub.isDestroyed || bottom != null) return
            val display = Screens.second(hub) ?: return
            if (pageDisplayId == display.displayId) return
            L10n.apply(Prefs(hub).appLanguage, null)
            refreshTrainer()
            bottom = DualScreenPresentation(hub, display) { context ->
                val view = ImageView(context).apply {
                    visibility = View.GONE
                    scaleType = ImageView.ScaleType.FIT_XY
                    setOnTouchListener { v, event ->
                        val shown = picture
                        if (event.actionMasked == MotionEvent.ACTION_DOWN && shown != null && v.width > 0 && v.height > 0) {
                            val x = (event.x * shown.width / v.width).toInt()
                            val y = (event.y * shown.height / v.height).toInt()
                            runOnRenderThread { emitSignal("bottom_touch", x, y) }
                        }
                        true
                    }
                }
                bottomView = view
                FrameLayout(context).apply {
                    addView(HubCompanion.view(context, trainer) { open_settings() })
                    addView(view)
                }
            }.also { opened ->
                runCatching { opened.show() }.onFailure { Log.w(TAG, "couldn't open the bottom screen", it) }
            }
        }

        private fun showPicture() {
            val bitmap = picture ?: return
            openBottom()
            // Square pixels, as the hub draws them: scaled up here without smoothing (the view's own
            // scaling filters whatever the drawable says), to the screen's size.
            val view = bottomView ?: return
            val target = Screens.second(hub)?.let { display ->
                DisplayMetrics().also { @Suppress("DEPRECATION") display.getRealMetrics(it) }
            }
            val shown = if (target != null && target.widthPixels > 0 && target.heightPixels > 0)
                Bitmap.createScaledBitmap(bitmap, target.widthPixels, target.heightPixels, false) else bitmap
            view.setImageDrawable(BitmapDrawable(hub.resources, shown).apply { isFilterBitmap = false })
            view.visibility = View.VISIBLE
        }

        // One screen: no bottom screen to show the companion on. PokeDaisy's tab at the right edge opens it as a
        // window over the island, as in a game. Touch only: the buttons stay with the island.

        private var openTab: View? = null
        private var window: View? = null

        private fun showTab() {
            if (openTab != null || Screens.second(hub) != null) return
            L10n.apply(Prefs(hub).appLanguage, null)
            val margin = (TAB_MARGIN_DP * hub.resources.displayMetrics.density).toInt()
            val place = FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.END).apply { bottomMargin = margin }
            openTab = HubCompanion.tab(hub, ::openWindow).also { hub.addContentView(it, place) }
        }

        private fun openWindow() {
            if (window != null) return
            refreshTrainer()
            val settings = {
                closeWindow()
                open_settings()
            }
            window = HubCompanion.window(hub, trainer, settings, ::closeWindow).also {
                hub.addContentView(it, FrameLayout.LayoutParams(-1, -1))
            }
        }

        private fun closeWindow() {
            window?.let { (it.parent as? ViewGroup)?.removeView(it) }
            window = null
        }

        private fun closeBottom() {
            runCatching { bottom?.dismiss() }
            bottom = null
            bottomView = null
        }

        private fun updateBottom() {
            if (hubResumed || topPageVisible) {
                openBottom()
                showPicture()
            } else {
                closeBottom()
            }
        }

        override fun onMainPause() = hub.runOnUiThread {
            hubResumed = false
            updateBottom()
        }

        override fun onMainResume() = hub.runOnUiThread {
            hubResumed = true
            // Back from a game or a page: the card's time and journeys may have changed.
            refreshTrainer()
            updateBottom()
            showTab()
        }

        override fun onMainDestroy() = hub.runOnUiThread {
            hubResumed = false
            topPageVisible = false
            DiscordSignIn.listener = null
            closeBottom()
        }
    }

    companion object {
        private const val TAG = "pokejourneys"

        /** The companion tab's gap from the screen's bottom, as in a game (SidePanel). */
        private const val TAB_MARGIN_DP = 12

        /** Where the island's exported data lives: Android/data/<package>/files/hub-data. */
        fun dataDir(context: Context): File = File(context.getExternalFilesDir(null), "hub-data")

        /** Whether this APK carries the hub. */
        fun packed(context: Context): Boolean =
            runCatching { context.assets.list("")?.contains("project.binary") == true }.getOrDefault(false)

        /** Whether this APK carries the hub and the island's data was built on the device ([HubBuildActivity]). */
        fun ready(context: Context): Boolean {
            if (!packed(context)) return false
            val data = HubBuildActivity.ready(context)
            if (!data) Log.w(TAG, "Victory Island data not built yet in ${dataDir(context)}")
            return data
        }

        /** Main process: opens the hub over [from] when it's [ready], with the library's games as journeys; with the
         * hub packed but its data not built yet, opens the first-run build, which opens the hub when it's done. */
        fun open(from: Activity, prefs: Prefs): Boolean {
            if (!ready(from)) {
                if (!packed(from)) return false
                HubBuildActivity.open(from)
                return true
            }
            writeJourneys(from, prefs)
            val app = from.applicationContext
            thread(name = "pokejourneys-library-scan") {
                runCatching {
                    RomFolder.scan(app, prefs)
                    GameTitles.identify(app, RomFolder.libraryRoms(app, prefs))
                    writeJourneys(app, prefs)
                }.onFailure { Log.w(TAG, "couldn't refresh journeys", it) }
            }
            from.startActivity(Intent(from, HubActivity::class.java))
            return true
        }

        /** Main process, with PokeDaisy's screens off ([com.pokedaisy.app.JourneyRules.POKEDAISY_SCREENS]): opens the
         * hub in place of the library [from], which closes, so leaving the island leaves the app. */
        fun replaceLibrary(from: Activity, prefs: Prefs) {
            if (!open(from, prefs)) android.widget.Toast.makeText(from, "Victory Island isn't installed yet.", android.widget.Toast.LENGTH_LONG).show()
            from.finish()
        }

        /** Main process: journeys.json in [dataDir], the captain's list: [{"name": ..., "rom": ...}]. */
        @Synchronized
        fun writeJourneys(context: Context, prefs: Prefs) {
            runCatching {
                val list = JSONArray()
                for (rom in RomFolder.libraryRoms(context, prefs)) {
                    val generation = when (GameTitles.platform(context, rom)) {
                        RomCategory.GB -> 1
                        RomCategory.GBC -> 2
                        RomCategory.NDS -> if (RomIdentity.ndsGameCode(rom)?.take(3) in setOf("IRB", "IRA", "IRE", "IRD")) 5 else 4
                        else -> 3
                    }
                    val variant = GameTitles.isKnownDsVariant(context, rom)
                    val label = GameTitles.label(context, prefs, rom)
                    val name = if (variant && !label.endsWith(JourneyDsCatalog.VARIANT_SUFFIX)) label + JourneyDsCatalog.VARIANT_SUFFIX else label
                    list.put(JSONObject().put("name", name).put("rom", rom.absolutePath)
                        .put("generation", generation).put("official", GameTitles.isKnownRetail(context, rom))
                        .put("variant", variant))
                }
                val json = AtomicFile(File(dataDir(context), "journeys.json"))
                val output = json.startWrite()
                try {
                    output.write(list.toString(2).encodeToByteArray())
                    json.finishWrite(output)
                } catch (error: Exception) {
                    json.failWrite(output)
                    throw error
                }
            }.onFailure { Log.w(TAG, "couldn't write journeys.json", it) }
        }
    }
}
