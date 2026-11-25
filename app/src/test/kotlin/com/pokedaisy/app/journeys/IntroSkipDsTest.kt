package com.pokedaisy.app.journeys

import com.pokedaisy.app.companion.data.GameCalls
import com.pokedaisy.app.companion.data.Gen4Text
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class IntroSkipDsTest {
    private class Memory : GameCalls {
        val data = ByteArray(0x400000)
        var writes = 0
        override fun call(fn: Long, a0: Int, a1: Int, a2: Int, a3: Int): Long = error("No game calls expected")
        override fun read(addr: Long, len: Int): ByteArray {
            val offset = (addr - 0x02000000).toInt()
            return if (offset < 0 || offset + len > data.size) byteArrayOf() else data.copyOfRange(offset, offset + len)
        }
        override fun write(addr: Long, bytes: ByteArray): Boolean {
            writes++
            bytes.copyInto(data, (addr - 0x02000000).toInt())
            return true
        }
        fun word(addr: Long, value: Long) {
            ByteArray(4) { (value ushr (it * 8)).toByte() }.copyInto(data, (addr - 0x02000000).toInt())
        }
        fun word(addr: Long): Long = read(addr, 4).withIndex().fold(0L) { v, (i, b) ->
            v or ((b.toLong() and 255) shl (8 * i))
        }
    }

    private val game = IntroSkipDs.Game(0x02111868, 0x021D2228, 53,
        listOf(0x021E5901, 0x021E5995, 0x021E5B49), 80, 0x120, "Barry")
    private val application = 0x02260000L
    private val work = 0x022A0000L
    private val player = 0x022A1000L
    private val rival = 0x022A2000L
    private val playerText = 0x022A3000L
    private val rivalText = 0x022A4000L
    private val session get() = IntroSkipDs.Session(game, true, "Riley", false)

    private fun ready(): Memory = Memory().apply {
        word(game.application + 4, application)
        for ((i, function) in game.functions.withIndex()) word(application + i * 4, function)
        word(application + 12, game.overlay.toLong())
        word(application + 16, 2)
        word(application + 20, 1)
        word(application + 24, game.application + 16)
        word(application + 28, work)
        word(work, game.heap.toLong())
        word(game.saveData, 0x02280000)
        word(work + 4, 0x02280000)
        word(work + game.playerArgs, player)
        word(work + game.playerArgs + 4, rival)
        for ((args, text) in listOf(player to playerText, rival to rivalText)) {
            word(args + 12, 7)
            word(args + 24, text)
            word(text, 32)
            word(text + 4, 0xB6F8D2EC)
        }
    }

    @Test
    fun initializedIntroWritesTheHubIdentityAndEntersNormalCleanup() {
        val memory = ready()
        assertTrue(IntroSkipDs.complete(memory, session))
        assertEquals("Riley", Gen4Text.name(memory.read(playerText + 8, 16), 0, 8))
        assertEquals("Barry", Gen4Text.name(memory.read(rivalText + 8, 16), 0, 8))
        assertEquals(1, memory.word(player + 4).toInt())
        assertEquals(2, memory.word(application + 20).toInt())
        assertEquals(4, memory.writes)
        assertFalse(IntroSkipDs.complete(memory, session))
        assertEquals(4, memory.writes)
    }

    @Test
    fun anActiveDialoguePrinterPreventsTheSkip() {
        val memory = ready()
        memory.word(work + 12, 1)
        assertFalse(IntroSkipDs.complete(memory, session))
        assertEquals(0, memory.writes)
    }

    @Test
    fun mismatchedCallbacksAndUninitializedResourcesAreNeverWritten() {
        for (change in listOf<(Memory) -> Unit>(
            { it.word(application + 4, 0x021E5999) },
            { it.word(work + 4, 0x02280004) },
            { it.word(rivalText + 4, 0) },
            { it.word(playerText, 4) },
            { it.word(application + 36, 0x022B0000) },
        )) {
            val memory = ready()
            change(memory)
            assertFalse(IntroSkipDs.complete(memory, session))
            assertEquals(0, memory.writes)
        }
    }

    @Test
    fun trainerNamesUseTheExistingGen4CharacterMap() {
        val codes = Gen4Text.encodeName("Kris-7!")
        val bytes = (codes.toList() + 0xFFFF).flatMap { listOf(it.toByte(), (it shr 8).toByte()) }.toByteArray()
        assertEquals("Kris-7!", Gen4Text.name(bytes, 0, 8))
    }
}
