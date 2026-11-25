package com.pokedaisy.app.journeys

import android.content.Context
import android.util.Log
import com.pokedaisy.app.MgbaCore
import com.pokedaisy.app.Prefs
import com.pokedaisy.app.companion.data.GameCalls
import java.util.zip.CRC32

/**
 * Seeds the live trainer save block at the new-game handoff. The cart initializes all progress itself and uses
 * its normal spawn: the moving truck in Hoenn or the bedroom in FireRed / LeafGreen.
 *
 * The game's own way, between frames (the companion's GameCalls): the moment the main menu's NEW GAME hands over to
 * the speech (Emerald: a task on Task_NewGameBirchSpeech_Init; FireRed / LeafGreen: gMain.callback2 on
 * CB2_NewGameScene), before the speech's first frame, the gender and name go into SaveBlock2 (+8, +0) and the rest is
 * what the speech's last task does: FreeAllWindowBuffers, SetMainCallback2(CB2_NewGame), DestroyTask. CB2_NewGame's
 * NewGameInitData sets the options' defaults and keeps the name, gender and (FireRed) rival's name, as after the
 * speech. Addresses follow pret's symbol files. Emerald and FireRed / LeafGreen check each called function's
 * first 32 bytes. Ruby and Sapphire use exact whole-cartridge SHA-1 identities.
 */
object IntroSkip {
    private class Game(
        val gMain: Long, val gTasks: Long, val saveBlock2Ptr: Long,
        /** Emerald: the speech's first task function; FireRed / LeafGreen: the new-game scene's callback2. */
        val speech: Long,
        /** FireRed / LeafGreen: the scene's task (destroyed with it). */
        val sceneTask: Long,
        val setMainCallback2: Long, val freeAllWindowBuffers: Long, val destroyTask: Long, val cb2NewGame: Long,
        /** Emerald: NewGameBirchSpeech_SetDefaultPlayerName(nameId); FireRed: GetDefaultName(hasPlayerBeenNamed, rivalChoice). */
        val defaultName: Long,
        val fireRed: Boolean,
        /** CRC32 of the first 32 bytes of setMainCallback2, freeAllWindowBuffers, destroyTask, cb2NewGame, defaultName. */
        val heads: List<Long>,
        val directSaveBlock: Boolean = false,
    )

    private val EMERALD = Game(
        0x030022C0, 0x03005E00, 0x03005D90, 0x080307B0, 0,
        0x08000540, 0x08003604, 0x080A909C, 0x08085EF8, 0x08031DC4, false,
        listOf(0x6228571DL, 0x548A07C2L, 0x533F540CL, 0xBECDF1BBL, 0x104BEF3FL),
    )
    private val FR_HEADS = listOf(0x7FD43C20L, 0x251CDB4AL, 0x533F540CL, 0x01097BFBL, 0x9A628C73L)
    private fun fireRed(rev1: Boolean, scene: Long, task: Long, name: Long) = Game(
        0x030030F0, 0x03005090, 0x0300500C, scene, task,
        if (rev1) 0x08000558 else 0x08000544, if (rev1) 0x08003EE0 else 0x08003ECC,
        if (rev1) 0x0807751C else 0x08077508, if (rev1) 0x08056658 else 0x08056644, name, true, FR_HEADS,
    )

    /** By the cart's whole-ROM CRC32 (No-Intro's). */
    private val GAMES: Map<Long, Game> = mapOf(
        0x1F1C08FBL to EMERALD,
        0xDD88761CL to fireRed(false, 0x0812EB10, 0x0812EB58, 0x08131754),   // FireRed (USA)
        0x84EE4776L to fireRed(true, 0x0812EB88, 0x0812EBD0, 0x081317CC),    // FireRed (USA, Europe) (Rev 1)
        0xD69C96CCL to fireRed(false, 0x0812EAE8, 0x0812EB30, 0x0813172C),   // LeafGreen (USA)
        0xDAFFECECL to fireRed(true, 0x0812EB60, 0x0812EBA8, 0x081317A4),    // LeafGreen (USA, Europe) (Rev 1)
    )

    /** The English Ruby and Sapphire symbol maps are keyed by exact cartridge SHA-1. */
    private fun hoenn(newGame: Long, destroyTask: Long) = Game(
        0, 0x03004B20, 0x02024EA4, 0x0800A1F4, 0,
        0x080003CC, 0, destroyTask, newGame, 0, false, emptyList(), directSaveBlock = true,
    )
    private val RUBY_LATE = hoenn(0x08054430, 0x0807AB94)
    private val SAPPHIRE_LATE = hoenn(0x08054434, 0x0807AB98)
    private val RUBY_SAPPHIRE = mapOf(
        "f28b6ffc97847e94a6c21a63cacf633ee5c8df1e" to hoenn(0x08054410, 0x0807AB74),
        "610b96a9c9a7d03d2bafb655e7560ccff1a6d894" to RUBY_LATE,
        "5b64eacf892920518db4ec664e62a086dd5f5bc8" to RUBY_LATE,
        "3ccbbd45f8553c36463f13b938e833f652b793e4" to hoenn(0x08054414, 0x0807AB78),
        "4722efb8cd45772ca32555b98fd3b9719f8e60a9" to SAPPHIRE_LATE,
        "89b45fb172e6b55d51fc0e61989775187f6fe63c" to SAPPHIRE_LATE,
    )

    private class Armed(val game: Game, val female: Boolean, val name: ByteArray?, autoStart: Boolean) {
        var bootFrames = if (autoStart) 0 else BOOT_TIMEOUT
    }

    private const val BOOT_TIMEOUT = 1800
    @Volatile private var armed: Armed? = null
    val isArmed get() = armed != null

    /** A ROM loaded ([crc]: its whole-file CRC32): armed when this cart is one of ours and wears the creator's look. */
    fun arm(context: Context, crc: Long, romKey: String, identity: String? = null, autoStart: Boolean = false) {
        armed = null
        if (Prefs(context).playerLookFor(romKey) != CreatorLook.PICK) return
        val look = CreatorLook.saved(context.filesDir) ?: return
        val game = GAMES[crc] ?: RUBY_SAPPHIRE[identity] ?: return
        val female = look.optString("gender", "m") == "f"
        val name = encode(look.optString("name", "")) ?: if (game.directSaveBlock) encode(if (female) "MAY" else "BRENDAN") else null
        armed = Armed(game, female, name, autoStart)
        Log.i("pokedaisy", "intro skip: armed")
    }

    /** A fresh cartridge can advance its title and New Game menus. Player input takes over immediately. */
    fun bootKeys(keys: Int): Int {
        val a = armed ?: return keys
        if (keys != 0) a.bootFrames = BOOT_TIMEOUT
        if (a.bootFrames >= BOOT_TIMEOUT) return keys
        return if (a.bootFrames++ % 32 == 0) com.pokedaisy.app.companion.data.CoreKey.START or com.pokedaisy.app.companion.data.CoreKey.A else 0
    }

    /** Gen 3's text: A-Z 0xBB.., a-z 0xD5.., 0-9 0xA1.., space 0; up to 7, ended by 0xFF. Null if nothing's left. */
    internal fun encode(name: String): ByteArray? {
        val out = name.trim().mapNotNull { c ->
            when (c) {
                in 'A'..'Z' -> 0xBB + (c - 'A'); in 'a'..'z' -> 0xD5 + (c - 'a'); in '0'..'9' -> 0xA1 + (c - '0')
                ' ' -> 0; '.' -> 0xAD; '-' -> 0xAE; '!' -> 0xAB; '?' -> 0xAC
                else -> null
            }
        }.take(7)
        if (out.isEmpty()) return null
        return ByteArray(8) { i -> (out.getOrNull(i) ?: 0xFF).toByte() }
    }

    private fun u32(b: ByteArray, o: Int) = (b[o].toLong() and 0xFF) or ((b[o + 1].toLong() and 0xFF) shl 8) or
        ((b[o + 2].toLong() and 0xFF) shl 16) or ((b[o + 3].toLong() and 0xFF) shl 24)

    /** Each frame on the emu thread ([calls] runnable now): the speech starting is skipped once. */
    fun frame(calls: GameCalls) {
        val a = armed ?: return
        val g = a.game
        val tasks = calls.read(g.gTasks, 16 * 0x28)
        if (tasks.size < 16 * 0x28) return
        fun taskOn(fn: Long) = (0 until 16).firstOrNull { i -> tasks[i * 0x28 + 4].toInt() != 0 && u32(tasks, i * 0x28) == (fn or 1) }
        val task = if (g.fireRed) {
            val cb2 = calls.read(g.gMain + 4, 4).takeIf { it.size == 4 }?.let { u32(it, 0) } ?: return
            if (cb2 != (g.speech or 1)) return
            taskOn(g.sceneTask) ?: return
        } else taskOn(g.speech) ?: return
        armed = null
        val functions = listOf(g.setMainCallback2, g.freeAllWindowBuffers, g.destroyTask, g.cb2NewGame, g.defaultName)
        if (g.heads.indices.any { i -> CRC32().apply { update(calls.read(functions[i], 32)) }.value != g.heads[i] }) {
            Log.w("pokedaisy", "intro skip: the game's code didn't match, left as it is")
            return
        }
        val sb2 = if (g.directSaveBlock) g.saveBlock2Ptr else
            calls.read(g.saveBlock2Ptr, 4).takeIf { it.size == 4 }?.let { u32(it, 0) } ?: return
        if (sb2 !in 0x02000000L..0x0203FFF0L) return
        calls.write(sb2 + 8, byteArrayOf(if (a.female) 1 else 0))
        if (a.name != null) calls.write(sb2, a.name)
        else if (g.fireRed) calls.call(g.defaultName, 0, 0) else calls.call(g.defaultName, 0)
        // FireRed / LeafGreen: the rival takes the first of the speech's names.
        if (g.fireRed) calls.call(g.defaultName, 1, 0)
        if (g.freeAllWindowBuffers != 0L) calls.call(g.freeAllWindowBuffers)
        calls.call(g.setMainCallback2, (g.cb2NewGame or 1).toInt())
        calls.call(g.destroyTask, task)
        Log.i("pokedaisy", "intro skip: the speech skipped, new game as the creator's trainer")
    }
}
