package com.pokedaisy.app.journeys

import android.annotation.SuppressLint
import android.app.Activity
import android.app.Presentation
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Color
import android.content.Context
import android.os.Bundle
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import com.pokedaisy.app.Screens
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.util.UUID
import kotlin.concurrent.thread

/** Offline Battle Dome: Showdown owns the rules and simulator, while the app owns the Vault and rewards. */
class BattleDomeActivity : Activity() {
    private lateinit var main: WebView
    private var controls: WebView? = null
    private var bottom: Presentation? = null
    private lateinit var art: DomeArt
    private lateinit var account: String
    private val matchId = UUID.randomUUID().toString().replace("-", "")
    private var roster: JSONObject? = null
    private var pageReady = false
    private var resultRecorded = false
    private var rewardPending = false
    private var lastState: String? = null
    private var lastStick = 0L
    private var resumed = false
    private var dualAvailable = false
    private var pvp: PvpBattle? = null
    private val mode get() = intent.getStringExtra("mode").orEmpty().takeIf { it in MODES } ?: "practice"

    @Suppress("DEPRECATION")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        account = DiscordSignIn.accountId(filesDir)
        art = DomeArt(this)
        dualAvailable = Screens.second(this) != null
        // Debug builds only: the battle pages can be inspected from a PC (chrome://inspect).
        if ((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        main = makePage(false)
        setContentView(main)
        if (mode == "pvp") {
            pvp = PvpBattle(this, JSONObject(intent.getStringExtra("battle_start").orEmpty())) { event ->
                runOnUiThread { script(main, "window.DomePvp.receive($event)") }
            }
            roster = JSONObject()
            boot()
            return
        }
        thread(name = "dome-roster") {
            val data = runCatching {
                val result = JourneysBridge.run(this, "battle-roster")
                if (!result.ok) throw IllegalStateException(result.error)
                JSONObject(result.output)
            }.getOrElse { JSONObject().put("pokemon", org.json.JSONArray()).put("error", "Couldn't read the Vault. Return to the hub and try again.") }
            runOnUiThread { roster = data; boot() }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun makePage(control: Boolean, pageContext: Context = this): WebView = WebView(pageContext).apply {
        setBackgroundColor(Color.rgb(28, 42, 59))
        // A controller press takes Android out of touch mode, which would draw its focus highlight over the whole page.
        if (android.os.Build.VERSION.SDK_INT >= 26) defaultFocusHighlightEnabled = false
        settings.javaScriptEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.blockNetworkLoads = true
        addJavascriptInterface(Bridge(control), "DomeNative")
        webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                val uri = request.url
                if (uri.scheme != "https" || uri.host != HOST) return empty()
                return runCatching {
                    val path = uri.path.orEmpty()
                    when {
                        path == "/battle.js" || path == "/controls.js" || path == "/style.css" ->
                            WebResourceResponse(if (path.endsWith("css")) "text/css" else "application/javascript", "UTF-8", assets.open("dome$path"))
                        path == "/font.ttf" -> WebResourceResponse("font/ttf", null, assets.open("fonts/PixelOperator.ttf"))
                        path == "/theme/menu.png" -> {
                            val file = File(HubActivity.dataDir(this@BattleDomeActivity), "ui/firered/menu.png")
                            if (file.isFile) WebResourceResponse("image/png", null, file.inputStream()) else empty()
                        }
                        // FireRed's battle interface, exported from the player's own cartridge into hub data.
                        path.startsWith("/theme/battle/") -> {
                            val name = path.removePrefix("/theme/battle/")
                            val file = File(HubActivity.dataDir(this@BattleDomeActivity), "ui/firered-battle/$name")
                            if (!BATTLE_ART.matches(name) || !file.isFile) empty()
                            else WebResourceResponse(if (name.endsWith(".json")) "application/json" else "image/png", null, file.inputStream())
                        }
                        path.startsWith("/sprite/") -> {
                            val id = path.removePrefix("/sprite/").toIntOrNull() ?: return empty()
                            val bytes = art.picture(id, uri.getQueryParameter("back") == "1", uri.getQueryParameter("shiny") == "1", uri.getQueryParameter("name").orEmpty())
                            if (bytes == null) empty() else WebResourceResponse("image/png", null, ByteArrayInputStream(bytes))
                        }
                        else -> empty()
                    }
                }.getOrElse { empty() }
            }
        }
        val script = if (control) "controls.js" else "battle.js"
        val html = """<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'"><link rel="stylesheet" href="style.css"></head><body><main id="app"><p>Preparing the Battle Dome…</p></main><script src="$script"></script></body></html>"""
        loadDataWithBaseURL("https://$HOST/", html, "text/html", "UTF-8", null)
    }

    private fun empty() = WebResourceResponse("text/plain", "UTF-8", ByteArrayInputStream(ByteArray(0)))
    private fun script(view: WebView?, value: String) { if (!isDestroyed) view?.evaluateJavascript(value, null) }
    private fun boot() {
        val data = roster ?: return
        if (!pageReady || isDestroyed) return
        val look = CreatorLook.saved(filesDir)
        val config = JSONObject().put("mode", mode).put("trainer", look?.optString("name")?.takeIf { it.isNotBlank() } ?: "Trainer")
            .put("gender", if (look?.optString("gender") == "f") "f" else "m")
            .put("roster", data).put("dual", dualAvailable).put("matchId", matchId)
        pvp?.config?.let { start ->
            for (key in listOf("battle", "format", "seed", "side", "players")) config.put(key, start.get(key))
        }
        script(main, "window.DomeApp.boot($config)")
        pvp?.start()
    }

    private inner class Bridge(private val control: Boolean) {
        @JavascriptInterface fun ready() = runOnUiThread {
            if (control) lastState?.let { script(controls, "window.DomeControls.render($it)") }
            else { pageReady = true; boot() }
        }
        @JavascriptInterface fun action(message: String) = runOnUiThread {
            if (message.length <= 8192) script(main, "window.DomeApp.action(${JSONObject.quote(message)})")
        }
        @JavascriptInterface fun frame(message: String) {
            if (control || message.length > 500_000) return
            runOnUiThread {
                lastState = message
                script(controls, "window.DomeControls?.render($message)")
                val data = runCatching { JSONObject(message) }.getOrNull() ?: return@runOnUiThread
                if (mode != "pvp" && data.optJSONObject("battle")?.optBoolean("ended") == true && !resultRecorded) {
                    resultRecorded = true
                    if (data.getJSONObject("battle").optBoolean("won")) award()
                }
            }
        }
        @JavascriptInterface fun pvpChoice(turn: Int, choice: String, check: String) {
            if (!control) pvp?.choice(turn, choice, check)
        }
        @JavascriptInterface fun pvpResult(winner: Int, check: String) {
            if (!control) pvp?.result(winner, check)
        }
        @JavascriptInterface fun pvpForfeit() {
            if (!control) pvp?.forfeit { runOnUiThread { returnToHub() } }
        }
        @JavascriptInterface fun close() = runOnUiThread {
            if (mode == "pvp") pvp?.settled { runOnUiThread { returnToHub() } }
            else returnToHub()
        }
    }

    private fun returnToHub() {
        if (isDestroyed || isFinishing) return
        if (!rewardPending) {
            // Restore controller focus to the hub's display after closing the bottom-screen controls.
            startActivity(Intent(this@BattleDomeActivity, HubActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT), Screens.mainDisplayLaunch(this@BattleDomeActivity))
            finish()
        }
    }

    private fun award() {
        if (mode == "pvp") return
        rewardPending = true
        thread(name = "dome-result") {
            val message = runCatching {
                check(DiscordSignIn.accountId(filesDir) == account) { "The trainer account changed." }
                val rank = DomeRewards.recordWin(File(filesDir, "accounts/$account"), matchId)
                "You earned 1 Experience! Total: ${rank.winPoints}. Rating stays at ${rank.rating}."
            }.getOrElse { "Your win could not be recorded. Your saved Pokémon are unchanged." }
            runOnUiThread { rewardPending = false; script(main, "window.DomeApp.reward(${JSONObject.quote(message)})") }
        }
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        dualAvailable = false
        Screens.second(this)?.let { display ->
            val presentation = object : Presentation(this, display) {
                override fun dispatchKeyEvent(event: KeyEvent): Boolean =
                    if (event.keyCode in CONTROL_KEYS) this@BattleDomeActivity.dispatchKeyEvent(event) else super.dispatchKeyEvent(event)
                override fun onGenericMotionEvent(event: MotionEvent): Boolean =
                    this@BattleDomeActivity.onGenericMotionEvent(event) || super.onGenericMotionEvent(event)
            }
            runCatching {
                bottom = presentation
                controls = makePage(true, presentation.context)
                presentation.setContentView(controls!!, FrameLayout.LayoutParams(-1, -1))
                presentation.show()
                presentation.window?.setLayout(-1, -1)
                @Suppress("DEPRECATION")
                presentation.window?.decorView?.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or
                    View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                dualAvailable = true
            }.onFailure {
                controls?.destroy(); controls = null
                runCatching { presentation.dismiss() }; bottom = null
            }
        }
        script(main, "window.DomeApp?.display($dualAvailable)")
    }
    override fun onPause() {
        resumed = false
        controls?.destroy(); controls = null
        bottom?.dismiss(); bottom = null
        super.onPause()
    }
    override fun onDestroy() { pvp?.close(); main.destroy(); super.onDestroy() }

    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onBackPressed() { script(controls ?: main, "window.DomeKey?.('back')") }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val key = when (event.keyCode) {
            KeyEvent.KEYCODE_DPAD_UP -> "up"; KeyEvent.KEYCODE_DPAD_DOWN -> "down"
            KeyEvent.KEYCODE_DPAD_LEFT -> "left"; KeyEvent.KEYCODE_DPAD_RIGHT -> "right"
            KeyEvent.KEYCODE_BUTTON_A, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_DPAD_CENTER -> "accept"
            KeyEvent.KEYCODE_BUTTON_B, KeyEvent.KEYCODE_ESCAPE -> "back"
            else -> null
        }
        if (key != null) {
            if (event.action == KeyEvent.ACTION_DOWN) script(controls ?: main, "window.DomeKey?.('$key')")
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onGenericMotionEvent(event: MotionEvent): Boolean {
        if (event.action == MotionEvent.ACTION_MOVE && resumed) {
            val x = event.getAxisValue(MotionEvent.AXIS_X) + event.getAxisValue(MotionEvent.AXIS_HAT_X)
            val y = event.getAxisValue(MotionEvent.AXIS_Y) + event.getAxisValue(MotionEvent.AXIS_HAT_Y)
            if (maxOf(kotlin.math.abs(x), kotlin.math.abs(y)) > .55f) {
                val now = android.os.SystemClock.uptimeMillis()
                if (now - lastStick > 160) {
                    lastStick = now
                    val key = if (kotlin.math.abs(x) > kotlin.math.abs(y)) { if (x > 0) "right" else "left" } else if (y > 0) "down" else "up"
                    script(controls ?: main, "window.DomeKey?.('$key')")
                }
                return true
            }
        }
        return super.onGenericMotionEvent(event)
    }

    companion object {
        private const val HOST = "dome.pokejourneys.local"
        private val MODES = setOf("practice", "practice_doubles", "practice_triples", "pvp")
        private val BATTLE_ART = Regex("""[a-z0-9_-]+\.(png|json)""")
        private val CONTROL_KEYS = setOf(KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_DPAD_LEFT,
            KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_BUTTON_A, KeyEvent.KEYCODE_BUTTON_B, KeyEvent.KEYCODE_ENTER,
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ESCAPE)
        fun start(from: Activity, mode: String, battleStart: String? = null) {
            if (mode !in MODES) return
            if (mode == "pvp" && battleStart == null) return
            from.startActivity(Intent(from, BattleDomeActivity::class.java).putExtra("mode", mode)
                .putExtra("battle_start", battleStart), Screens.mainDisplayLaunch(from))
        }
    }
}
