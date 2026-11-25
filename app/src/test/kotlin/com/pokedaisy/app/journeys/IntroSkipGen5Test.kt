package com.pokedaisy.app.journeys

import com.pokedaisy.app.companion.data.GameCalls
import org.junit.Assert.*
import org.junit.Test

class IntroSkipGen5Test {
    private class Memory : GameCalls {
        private val data = ByteArray(0x400000)
        var writes = 0
        override fun call(fn: Long, a0: Int, a1: Int, a2: Int, a3: Int): Long = error("No game calls expected")
        override fun read(addr: Long, len: Int): ByteArray {
            val at = (addr - 0x02000000).toInt()
            return if (at < 0 || at + len > data.size) byteArrayOf() else data.copyOfRange(at, at + len)
        }
        override fun write(addr: Long, bytes: ByteArray): Boolean {
            writes++
            put(addr, bytes)
            return true
        }
        fun put(addr: Long, bytes: ByteArray) = bytes.copyInto(data, (addr - 0x02000000).toInt())
        fun word(addr: Long, value: Long) = put(addr, ByteArray(4) { (value ushr (8 * it)).toByte() })
        fun word(addr: Long) = read(addr, 4).withIndex().fold(0L) { value, (i, b) -> value or ((b.toLong() and 255) shl (i * 8)) }
    }
    private val game = IntroSkipGen5.Game(0x02141858, 162, listOf(0x021A0055, 0x021A0175, 0x021A02D1), 0x58, 0x34, 0x64)
    private val system = 0x02200000L
    private val process = 0x02200100L
    private val template = 0x021A1914L
    private val work = 0x02210000L
    private val status = 0x02211000L
    private val children = 0x02212000L
    private val main = game.functions[1] - 1
    private fun session() = IntroSkipGen5.Session(game, "Riley", true, 0x12345678, 9)
    private fun ready(phase: Int) = Memory().apply {
        word(game.processSystem, system)
        word(system + 8, process)
        word(process, template)
        word(process + 4, game.overlay.toLong())
        word(process + 8, phase.toLong())
        word(process + 20, work)
        game.functions.forEachIndexed { i, fn -> word(template + i * 4, fn) }
        word(work + game.statusOff, status)
        word(work + 8, status)
        word(work + 4, 0x02213000)
        word(work + game.statusOff + 4, 0x02213000)
        word(work + game.childrenOff, children)
        put(status + 0x1A, byteArrayOf(2, 23))
        put(main, byteArrayOf(0xF8.toByte(), 0xB5.toByte(), 0x1C, 0x1C))
    }
    @Test fun fullyInitializedIntroKeepsTheNativeExit() {
        val memory = ready(2)
        assertTrue(IntroSkipGen5.complete(memory, session()))
        assertEquals("Riley", String(memory.read(status, 10), Charsets.UTF_16LE))
        assertEquals("Hugh", String(memory.read(work + 0x64, 8), Charsets.UTF_16LE))
        assertEquals(0x12345678L, memory.word(status + 0x10))
        assertArrayEquals(byteArrayOf(9, 1), memory.read(status + 0x1C, 2))
        assertEquals(3L, memory.word(process + 8))
        assertEquals(0x1C1CB5F8L, memory.word(main))
    }
    @Test fun overlayLoadsFinishBeforeCleanupAndTheCallbackIsRestored() {
        val memory = ready(1)
        val session = session()
        assertFalse(IntroSkipGen5.complete(memory, session))
        assertEquals(1L, memory.word(process + 8))
        assertEquals(0x47702001L, memory.word(main))
        memory.word(process + 8, 3)
        assertTrue(IntroSkipGen5.complete(memory, session))
        assertEquals(0x1C1CB5F8L, memory.word(main))
    }
    @Test fun changedOverlaysAreNeverRestoredInto() {
        val memory = ready(1)
        val session = session()
        IntroSkipGen5.complete(memory, session)
        val writes = memory.writes
        memory.word(process + 4, 21)
        memory.word(process + 8, 3)
        assertTrue(IntroSkipGen5.complete(memory, session))
        assertEquals(writes, memory.writes)
    }
    @Test fun activeDialoguesAndUnknownCodeRemainUntouched() {
        for (change in listOf<(Memory) -> Unit>(
            { it.word(process + 12, 1) },
            { it.word(template + 4, game.functions[1] + 4) },
            { it.word(children + 8, 0x02215000) },
            { it.word(main, 0) },
            { it.word(work + game.statusOff, 0) },
            { it.put(status, byteArrayOf(82)) },
        )) {
            val memory = ready(2)
            change(memory)
            assertFalse(IntroSkipGen5.complete(memory, session()))
            assertEquals(0, memory.writes)
        }
    }
}
