package com.pokedaisy.app.journeys

import android.content.Context
import com.pokedaisy.app.MgbaCore
import com.pokedaisy.app.Prefs
import com.pokedaisy.app.companion.data.GameCalls

/** Advance a fresh GB cartridge only after its checked character and introduction blocks are installed. */
internal object IntroSkipGb {
    private class Session(val game: GbJourney.Game, val name: ByteArray) {
        var frames = 0
        var ready = false
    }
    @Volatile private var session: Session? = null

    fun arm(context: Context, identity: String?, key: String, fresh: Boolean) {
        session = null
        if (!fresh || Prefs(context).playerLookFor(key) != CreatorLook.PICK) return
        val game = GbJourney.games[identity] ?: return
        val look = CreatorLook.saved(context.filesDir) ?: return
        session = Session(game, GbJourney.encode(look.optString("name")))
    }

    fun cancel() { session = null }
    fun patchReady(success: Boolean) {
        if (success) session?.ready = true else cancel()
    }

    fun bootKeys(keys: Int): Int {
        val current = session ?: return keys
        if (keys != 0 || current.frames >= 1800) { cancel(); return keys }
        if (!current.ready) return keys
        return if (current.frames++ % 37 < 6) com.pokedaisy.app.companion.data.CoreKey.A else 0
    }

    fun frame(calls: GameCalls) {
        val current = session ?: return
        if (!current.ready) return
        val game = current.game
        val map = calls.read(game.map.toLong(), 1).firstOrNull()?.toInt()?.and(255)
        if (map == (if (game.generation == 1) 0x26 else 2) &&
            calls.read(game.name.toLong(), current.name.size).contentEquals(current.name)) cancel()
    }
}
