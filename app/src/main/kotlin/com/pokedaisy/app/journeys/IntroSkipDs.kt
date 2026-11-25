package com.pokedaisy.app.journeys

import android.content.Context
import android.util.Log
import com.pokedaisy.app.MgbaCore
import com.pokedaisy.app.Prefs
import com.pokedaisy.app.companion.data.GameCalls
import com.pokedaisy.app.companion.data.Gen4Text

/**
 * Complete the DS professor application after its resources initialize and before it starts printing dialogue.
 * The game's own exit copies the naming arguments into SaveData, releases its resources, and initializes the world.
 * Structure layouts follow pret/pokeplatinum and pret/pokeheartgold.
 */
internal object IntroSkipDs {
    internal data class Game(
        val application: Long,
        val saveData: Long,
        val overlay: Int,
        val functions: List<Long>,
        val heap: Int,
        val playerArgs: Int,
        val rivalName: String,
    )

    private val PLATINUM = Game(
        0x02101D28, 0x021C0794, 73, listOf(0x021D0D81, 0x021D0E21, 0x021D0F7D), 82, 0x70, "Barry",
    )
    private val HEARTGOLD = Game(
        0x02111868, 0x021D2228, 53, listOf(0x021E5901, 0x021E5995, 0x021E5B49), 80, 0x120, "",
    )
    private val DIAMOND_PEARL = Game(
        0x02106FA8, 0x02106FC0, 59, listOf(0x021D74E1, 0x021D7565, 0x021D76C1), 82, 0x70, "Barry",
    )
    private val games = mapOf(
        "a46233d8b79a69ea87aa295a0efad5237d02841e" to DIAMOND_PEARL,
        "99083bf15ec7c6b81b4ba241ee10abd9e80999ac" to DIAMOND_PEARL,
        "0862ec35b24de5c7e2dcb88c9eea0873110d755c" to PLATINUM,
        "ce81046eda7d232513069519cb2085349896dec7" to PLATINUM,
        "c5072bf51a5ecc51ade99d3506c023f5bac3eeb3" to PLATINUM,
        "4fcded0e2713dc03929845de631d0932ea2b5a37" to HEARTGOLD,
        "f8dc38ea20c17541a43b58c5e6d18c1732c7e582" to HEARTGOLD,
        "30793e274fb4c7ba070ae226edbdfe355504b1f5" to HEARTGOLD,
    )

    internal class Session(val game: Game, val female: Boolean, val name: String, autoStart: Boolean) {
        var bootFrames = if (autoStart) 0 else BOOT_TIMEOUT
    }
    private const val BOOT_TIMEOUT = 1800
    @Volatile private var armed: Session? = null

    fun arm(context: Context, identity: String?, key: String, autoStart: Boolean) {
        armed = null
        if (!autoStart || Prefs(context).playerLookFor(key) != CreatorLook.PICK) return
        val game = games[identity] ?: return
        val look = CreatorLook.saved(context.filesDir) ?: return
        val name = look.optString("name").trim().take(7)
        if (name.isEmpty()) return
        armed = Session(game, look.optString("gender", "m") == "f", name, true)
    }

    fun bootKeys(keys: Int): Int {
        val session = armed ?: return keys
        if (keys != 0) session.bootFrames = BOOT_TIMEOUT
        if (session.bootFrames >= BOOT_TIMEOUT) return keys
        return if (session.bootFrames++ % 32 < 3) com.pokedaisy.app.companion.data.CoreKey.START or com.pokedaisy.app.companion.data.CoreKey.A else 0
    }

    fun frame(calls: GameCalls) {
        val session = armed ?: return
        if (complete(calls, session)) {
            armed = null
            Log.i("pokedaisy", "intro skip (DS): started as the hub trainer")
        }
    }

    /** All pointers and both naming strings are checked before the first write. */
    internal fun complete(calls: GameCalls, session: Session): Boolean {
        val game = session.game
        val application = word(calls, game.application + 4)
        if (!inRam(application)) return false
        val manager = calls.read(application, 0x28)
        if (manager.size != 0x28 || game.functions.indices.any { word(manager, it * 4) != game.functions[it] } ||
            word(manager, 12) != game.overlay.toLong() || word(manager, 16) != 2L || word(manager, 20) != 1L ||
            word(manager, 24) != game.application + 16 || word(manager, 36) != 0L) return false
        val data = word(manager, 28)
        if (!inRam(data)) return false
        if (word(calls, data) != game.heap.toLong() || word(calls, data + 4) != word(calls, game.saveData) ||
            word(calls, data + 12) != 0L || word(calls, data + 20) != 0L) return false
        val player = word(calls, data + game.playerArgs)
        val rival = word(calls, data + game.playerArgs + 4)
        val playerWrite = nameWrite(calls, player, session.name) ?: return false
        val rivalWrite = nameWrite(calls, rival, game.rivalName) ?: return false
        calls.write(playerWrite.first, playerWrite.second)
        calls.write(rivalWrite.first, rivalWrite.second)
        calls.write(player + 4, bytes(if (session.female) 1 else 0))
        // The initialized application's cleanup state runs before its normal exit callback.
        calls.write(application + 20, bytes(2))
        return true
    }

    private fun nameWrite(calls: GameCalls, args: Long, name: String): Pair<Long, ByteArray>? {
        if (!inRam(args) || word(calls, args + 12) != 7L) return null
        val text = word(calls, args + 24)
        if (!inRam(text)) return null
        val header = calls.read(text, 8)
        val chars = Gen4Text.encodeName(name)
        if (header.size != 8 || word(header, 4) != 0xB6F8D2ECL) return null
        val capacity = (header[0].toInt() and 255) or ((header[1].toInt() and 255) shl 8)
        if (capacity <= chars.size || capacity > 256) return null
        val value = ByteArray(8 + 2 * (chars.size + 1))
        header.copyInto(value)
        value[2] = chars.size.toByte()
        value[3] = 0
        for ((i, char) in (chars.toList() + 0xFFFF).withIndex()) {
            value[8 + i * 2] = char.toByte()
            value[9 + i * 2] = (char shr 8).toByte()
        }
        return text to value
    }

    private fun inRam(address: Long) = address in 0x02000000L..0x023FFBFFL && address and 3 == 0L
    private fun word(calls: GameCalls, address: Long) = word(calls.read(address, 4), 0)
    private fun word(data: ByteArray, offset: Int): Long =
        if (offset + 4 > data.size) -1 else (0..3).fold(0L) { value, i ->
            value or ((data[offset + i].toLong() and 255) shl (8 * i))
        }
    private fun bytes(value: Int) = ByteArray(4) { (value ushr (it * 8)).toByte() }
}
