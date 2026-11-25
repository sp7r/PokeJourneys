package com.pokedaisy.app.journeys

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.widget.Toast
import com.pokedaisy.app.GameTitles
import com.pokedaisy.app.LibraryActivity
import com.pokedaisy.app.PokeDaisyActivity
import com.pokedaisy.app.Prefs
import com.pokedaisy.app.RomCrcs
import com.pokedaisy.app.Screens
import com.pokedaisy.app.companion.i18n.tr
import java.io.File
import kotlin.concurrent.thread

/**
 * A journey picked in the hub ([HubActivity]), started from the main process as the library starts a game. No UI of
 * its own: it stays under the game and, when the game closes, records the journey's Pokémon for the Vault
 * ([JourneyIds.record]) and goes back to the hub.
 */
class JourneyLaunchActivity : Activity() {

    private var rom: File? = null
    private var started = false
    private var returning = false
    /** When the game was started, for the trainer card's play time ([TrainerStats]); 0 = not known. */
    private var startedAt = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val rom = intent.getStringExtra(EXTRA_ROM)?.let(::File)?.takeIf { it.isFile }
        if (rom == null) {
            Toast.makeText(this, tr("PokeJourneys can't read {0}", intent.getStringExtra(EXTRA_ROM).orEmpty()), Toast.LENGTH_LONG).show()
            finish()
            return
        }
        this.rom = rom
        started = savedInstanceState?.getBoolean(STATE_STARTED) == true
        startedAt = savedInstanceState?.getLong(STATE_STARTED_AT) ?: 0L
        if (started) return
        // The CRC (and an archive's unpacking) off the UI thread, as the library does before a launch.
        thread(name = "pokejourneys-prepare") {
            RomCrcs.prepare(this, rom)
            val prefs = Prefs(this)
            val startIdentity = runCatching { JourneyStart.prepare(this, prefs, rom) }
                .onFailure { Log.w("JourneyStart", "Couldn't prepare the hub trainer", it) }.getOrNull()
            val pendingItems = runCatching { HubEconomy.enter(this, prefs, rom) }
                .onFailure { Log.w("JourneyEconomy", "Couldn't sync the shared bag", it) }.getOrDefault(false)
            runOnUiThread {
                if (pendingItems && !isFinishing) {
                    Toast.makeText(this, tr("Save in the game before leaving so your shared bag can sync next time."),
                        Toast.LENGTH_LONG).show()
                }
                play(rom, startIdentity)
            }
        }
    }

    private fun play(rom: File, startIdentity: String?) {
        if (isFinishing) return
        val prefs = Prefs(this)
        prefs.lastRomPath = rom.absolutePath
        prefs.pushRecentRom(rom.absolutePath)
        startedAt = System.currentTimeMillis()
        started = true
        startActivity(
            Intent(this, PokeDaisyActivity::class.java).putExtra(LibraryActivity.EXTRA_ROM, rom.absolutePath)
                .putExtra(LibraryActivity.EXTRA_LAUNCHED_FROM, "hub")
                .putExtra(JourneyStart.EXTRA_IDENTITY, startIdentity),
            Screens.mainDisplayLaunch(this),
        )
    }

    override fun onResume() {
        super.onResume()
        if (!started || returning) return
        // Back from the game: record it, then back to the island.
        val rom = rom ?: return
        returning = true
        val prefs = Prefs(this)
        val app = applicationContext
        thread(name = "pokejourneys-record") {
            try {
                JourneyIds.record(app, prefs, rom)
                runCatching { HubEconomy.leave(app, rom) }
                    .onFailure { Log.w("JourneyEconomy", "Couldn't record journey money and items", it) }
                // The island's trainer card: the time in this game and its name.
                if (startedAt > 0) {
                    val known = GameTitles.isKnownRetail(app, rom) || GameTitles.isKnownDsVariant(app, rom)
                    val region = TrainerStats.Region.of(rom, GameTitles.platform(app, rom)).takeIf { known }
                    TrainerStats.played(app, (System.currentTimeMillis() - startedAt) / 1000, GameTitles.label(app, prefs, rom), region)
                }
                HubActivity.writeJourneys(app, prefs)
            } finally {
                runOnUiThread { finish() }
            }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putBoolean(STATE_STARTED, started)
        outState.putLong(STATE_STARTED_AT, startedAt)
    }

    companion object {
        private const val EXTRA_ROM = "rom"
        private const val STATE_STARTED = "started"
        private const val STATE_STARTED_AT = "startedAt"

        fun start(from: Activity, rom: File) {
            from.startActivity(Intent(from, JourneyLaunchActivity::class.java).putExtra(EXTRA_ROM, rom.absolutePath))
        }
    }
}
