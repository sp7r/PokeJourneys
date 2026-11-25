package com.pokedaisy.app.journeys

import android.app.Activity
import android.app.ActivityOptions
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.ResultReceiver
import android.util.Log
import android.view.Display
import androidx.activity.ComponentActivity
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.pokedaisy.app.Prefs
import com.pokedaisy.app.Screens
import com.pokedaisy.app.SettingsActivity
import com.pokedaisy.app.VaultActivity
import kotlin.concurrent.thread

/**
 * A screen of the app opened from the hub ([HubActivity]): the Vault (the PokeVault's clerk) or the settings (the
 * hub companion's SETTINGS button). The hub runs in its own process, so this starts the screen from the main one,
 * on the second screen when the device has one (the island stays up on the first). It stays under the screen with
 * no UI of its own and, when the screen closes, writes the journeys again (SETTINGS can add a ROMs folder) and
 * closes too.
 */
class HubPageActivity : Activity() {

    private var started = false

    @Suppress("DEPRECATION")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        started = savedInstanceState?.getBoolean(STATE_STARTED) == true
        if (started) return
        val page = when (intent.getStringExtra(EXTRA_PAGE)) {
            PAGE_VAULT -> VaultActivity::class.java
            PAGE_SETTINGS -> SettingsActivity::class.java
            else -> null
        }
        if (page == null) {
            finish()
            return
        }
        started = true
        val pageIntent = Intent(this, page)
        if (Screens.isOnMainDisplay(this)) {
            pageStatus(intent)?.let { pageIntent.putExtra(EXTRA_PAGE_STATUS, it) }
        }
        // Keep the page on this activity's display and wait for it to finish.
        try {
            startActivityForResult(pageIntent, REQUEST_PAGE)
        } catch (e: RuntimeException) {
            Log.w(TAG, "couldn't open the hub page", e)
            finish()
        }
    }

    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_PAGE) return
        val app = applicationContext
        thread(name = "pokejourneys-journeys") { HubActivity.writeJourneys(app, Prefs(app)) }
        finish()
    }

    override fun onDestroy() {
        super.onDestroy()
        if (isFinishing) pageStatus(intent)?.send(RESULT_OK, null)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putBoolean(STATE_STARTED, started)
    }

    companion object {
        const val PAGE_VAULT = "vault"
        const val PAGE_SETTINGS = "settings"
        private const val TAG = "pokejourneys"
        private const val EXTRA_PAGE = "page"
        private const val EXTRA_PAGE_STATUS = "pageStatus"
        private const val STATE_STARTED = "started"
        private const val REQUEST_PAGE = 1
        private const val PAGE_VISIBLE = 1
        private const val PAGE_HIDDEN = 2

        @Suppress("DEPRECATION")
        private fun pageStatus(intent: Intent?): ResultReceiver? = intent?.getParcelableExtra(EXTRA_PAGE_STATUS)

        /** A page on top keeps the hub card visible below while the page is in view. */
        internal fun reportTopPageVisibility(page: ComponentActivity) {
            val status = pageStatus(page.intent) ?: return
            page.lifecycle.addObserver(object : DefaultLifecycleObserver {
                override fun onStart(owner: LifecycleOwner) = status.send(PAGE_VISIBLE, null)

                override fun onStop(owner: LifecycleOwner) = status.send(PAGE_HIDDEN, null)
            })
        }

        private fun prefs(context: Context) = context.getSharedPreferences("hub-pages", Context.MODE_PRIVATE)

        /** Whether the pages open over the island on the first screen though there is a second (the hot wheel's SWAP). */
        fun onTop(context: Context): Boolean = prefs(context).getBoolean("onTop", false)

        fun setOnTop(context: Context, top: Boolean) = prefs(context).edit().putBoolean("onTop", top).apply()

        /**
         * Opens [page] over the island or in its own task on [display]. [onClosed] releases the hub's page slot and
         * restores its companion when the native page finishes in the main process.
         */
        fun start(
            from: Activity,
            page: String,
            display: Display?,
            onTopVisibilityChanged: (Boolean) -> Unit,
            onClosed: () -> Unit,
        ) {
            val status = object : ResultReceiver(Handler(Looper.getMainLooper())) {
                private var closed = false

                override fun onReceiveResult(resultCode: Int, resultData: Bundle?) {
                    if (closed) return
                    when (resultCode) {
                        PAGE_VISIBLE -> onTopVisibilityChanged(true)
                        PAGE_HIDDEN -> onTopVisibilityChanged(false)
                        RESULT_OK -> {
                            // Android may stop the child page after destroying the activity beneath it.
                            closed = true
                            onClosed()
                        }
                    }
                }
            }
            val intent = Intent(from, HubPageActivity::class.java)
                .putExtra(EXTRA_PAGE, page)
                .putExtra(EXTRA_PAGE_STATUS, status)
            if (display != null) {
                val onSecond = Intent(intent).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_MULTIPLE_TASK)
                try {
                    from.startActivity(onSecond, ActivityOptions.makeBasic().setLaunchDisplayId(display.displayId).toBundle())
                    return
                } catch (e: RuntimeException) {
                    Log.w(TAG, "couldn't open the hub page on display ${display.displayId}", e)
                }
            }
            try {
                from.startActivity(intent)
            } catch (e: RuntimeException) {
                Log.w(TAG, "couldn't start the hub page", e)
                onClosed()
            }
        }
    }
}
