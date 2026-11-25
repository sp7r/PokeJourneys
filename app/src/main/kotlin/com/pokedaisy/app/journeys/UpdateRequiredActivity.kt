package com.pokedaisy.app.journeys

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import com.pokedaisy.app.AppUpdateFlow
import com.pokedaisy.app.BuildConfig
import com.pokedaisy.app.UpdateDialog
import com.pokedaisy.app.companion.i18n.tr
import com.pokedaisy.app.companion.ui.GbaText
import com.pokedaisy.app.companion.ui.OptionColors
import com.pokedaisy.app.companion.ui.rememberGbaTextMetrics
import com.pokedaisy.app.companion.ui.theme.AppTheme

/**
 * A newer PokeJourneys is published on the server: it has to be installed before the player can sign in or play
 * online (the server refuses older versions too). The update offer has no LATER; BACK closes the app.
 */
class UpdateRequiredActivity : ComponentActivity() {
    private val updates by lazy { AppUpdateFlow(this, required = true) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        updates.check(manual = false)
        setContent {
            AppTheme {
                BackHandler { finishAffinity() }
                val m = rememberGbaTextMetrics()
                val small = rememberGbaTextMetrics(textScale = 1f)
                Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
                    if (updates.release == null) GbaText(
                        if (updates.checking) tr("LOOKING FOR THE UPDATE...") else tr("UPDATE POKEJOURNEYS TO KEEP PLAYING - CHECK THE CONNECTION AND OPEN THE APP AGAIN"),
                        OptionColors.label, OptionColors.labelShadow, m, maxLines = Int.MAX_VALUE,
                    )
                    UpdateDialog(updates, m, small)
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        updates.onResume()
    }

    companion object {
        /** Blocking: whether the official server has a newer release than this build. */
        fun needed(): Boolean = ServerUpdates.check(BuildConfig.VERSION_NAME) != null

        fun open(from: Activity) {
            from.runOnUiThread {
                from.startActivity(Intent(from, UpdateRequiredActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP))
            }
        }
    }
}
