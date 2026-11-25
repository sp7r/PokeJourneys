package com.pokedaisy.app.journeys

import android.content.Context
import android.util.Log
import com.pokedaisy.app.MgbaCore
import com.pokedaisy.app.Prefs
import com.pokedaisy.app.companion.data.GameCalls
import java.security.SecureRandom

/** Finish the initialized professor process before it creates its dialogue or naming child applications. */
internal object IntroSkipGen5 {
    internal data class Game(val processSystem: Long, val overlay: Int, val functions: List<Long>,
                             val statusOff: Int = 0x54, val childrenOff: Int = 0x30, val rivalOff: Int = 0)
    private val BLACK = Game(0x02146990, 88, listOf(0x021BC12D, 0x021BC231, 0x021BC2FD))
    private val WHITE = Game(0x021469B0, 88, BLACK.functions.map { it + 0x54 })
    private val BLACK2 = Game(0x02141858, 162, listOf(0x021A0055, 0x021A0175, 0x021A02D1), 0x58, 0x34, 0x64)
    private val WHITE2 = BLACK2.copy(processSystem = 0x02141898, functions = BLACK2.functions.map { it + 0x78 })
    private val games = mapOf(
        "26ad0b9967aa279c4a266ee69f52b9b2332399a5" to BLACK,
        "a68b3bedf5c1e53556e41e59cdf396c20b331896" to BLACK,
        "bc696a0dfb448c7b3a8a206f0f8214411a039208" to WHITE,
        "e51e6dfb8678a3d19dcd2a10691b96a569ca0abb" to BLACK2,
        "42f7a3daf0601064c9067a6a2903a83ec081442b" to BLACK2,
        "b5d7490be7b415b8f1e672a53e978a9cc667e56a" to WHITE2,
    )
    internal class Session(val game: Game, val name: String, val female: Boolean, val trainerId: Int, val view: Int) {
        var bootFrames = 0
        var patchedProcess = 0L
    }
    @Volatile private var armed: Session? = null

    fun arm(context: Context, identity: String?, key: String, fresh: Boolean) {
        armed = null
        if (!fresh || Prefs(context).playerLookFor(key) != CreatorLook.PICK) return
        val game = games[identity] ?: return
        val look = CreatorLook.saved(context.filesDir) ?: return
        val name = look.optString("name").trim().take(7)
        if (name.isEmpty()) return
        val random = SecureRandom()
        val female = look.optString("gender", "m") == "f"
        armed = Session(game, name, female, random.nextInt(), random.nextInt(8) + if (female) 8 else 0)
    }

    fun bootKeys(keys: Int): Int {
        val session = armed ?: return keys
        if (keys != 0) session.bootFrames = 1800
        if (session.bootFrames >= 1800) return keys
        return if (session.bootFrames++ % 32 < 3) com.pokedaisy.app.companion.data.CoreKey.START or com.pokedaisy.app.companion.data.CoreKey.A else 0
    }

    fun frame(calls: GameCalls) {
        val session = armed ?: return
        if (complete(calls, session)) {
            armed = null
            Log.i("pokedaisy", "intro skip (Gen 5): started as the hub trainer")
        }
    }

    internal fun complete(calls: GameCalls, session: Session): Boolean {
        val game = session.game
        val system = word(calls, game.processSystem)
        if (!ram(system)) return false
        val process = word(calls, system + 8)
        val main = game.functions[1] and 1L.inv()
        val mainHead = if (game.rivalOff == 0) MAIN_HEAD else MAIN_HEAD2
        if (session.patchedProcess != 0L) {
            val template = word(calls, process)
            if (process != session.patchedProcess || word(calls, process + 4) != game.overlay.toLong() ||
                !ram(template) || game.functions.indices.any { word(calls, template + it * 4) != game.functions[it] }) return true
            if (word(calls, process + 8) in 1L..2L) return false
            if (word(calls, process + 8) == 3L &&
                calls.read(main, 4).contentEquals(RETURN_DONE)) calls.write(main, mainHead)
            return true
        }
        if (!ram(process) || word(calls, process + 4) != game.overlay.toLong() ||
            word(calls, process + 8) !in 1L..2L || word(calls, process + 12) != 0L || word(calls, process + 28) != 0L) return false
        val template = word(calls, process)
        if (!ram(template) || game.functions.indices.any { word(calls, template + it * 4) != game.functions[it] }) return false
        val work = word(calls, process + 20)
        if (!ram(work)) return false
        val status = word(calls, work + game.statusOff)
        val children = word(calls, work + game.childrenOff)
        if (!ram(status) || !ram(children) || word(calls, children + 8) != 0L ||
            word(calls, work + 8) != status || word(calls, work + 4) != word(calls, work + game.statusOff + 4)) return false
        val trainer = calls.read(status, 0x20)
        if (trainer.size != 0x20 || trainer.take(16).any { it != 0.toByte() } || trainer[0x1A] != 2.toByte()) return false
        if (!calls.read(main, 4).contentEquals(mainHead)) return false
        calls.write(status, name(session.name))
        calls.write(status + 0x10, bytes(session.trainerId))
        calls.write(status + 0x1C, byteArrayOf(session.view.toByte(), if (session.female) 1 else 0))
        if (game.rivalOff != 0) calls.write(work + game.rivalOff, name("Hugh"))
        // STARTMENU_NewGameIntroEnd copies MyStatus into SaveData and starts the native new-game world.
        if (word(calls, process + 8) == 2L) {
            calls.write(process + 8, bytes(3))
            return true
        }
        // Overlay loading can span several frames inside init. Let it finish before the main callback returns done.
        calls.write(main, RETURN_DONE)
        session.patchedProcess = process
        session.bootFrames = 1800
        return false
    }

    private val MAIN_HEAD = byteArrayOf(0x38, 0xB5.toByte(), 0x1C, 0x1C)
    private val MAIN_HEAD2 = byteArrayOf(0xF8.toByte(), 0xB5.toByte(), 0x1C, 0x1C)
    private val RETURN_DONE = byteArrayOf(0x01, 0x20, 0x70, 0x47)
    private fun name(value: String) = ByteArray(16) { 0xFF.toByte() }.also { out ->
        for ((index, char) in value.take(7).withIndex()) {
            out[index * 2] = char.code.toByte()
            out[index * 2 + 1] = (char.code shr 8).toByte()
        }
    }
    private fun ram(address: Long) = address in 0x02000000L..0x023FFBFFL && address and 3 == 0L
    private fun word(calls: GameCalls, address: Long): Long {
        val data = calls.read(address, 4)
        return if (data.size != 4) -1 else (0..3).fold(0L) { value, i -> value or ((data[i].toLong() and 255) shl (8 * i)) }
    }
    private fun bytes(value: Int) = ByteArray(4) { (value ushr (it * 8)).toByte() }
}
