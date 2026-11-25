package com.pokedaisy.app.journeys

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertNull
import org.junit.Test

class IntroSkipTest {
    @Test
    fun encodesTheHubNameWithTheGen3CharacterSet() {
        assertArrayEquals(byteArrayOf(0xCC.toByte(), 0xDD.toByte(), 0xE0.toByte(), 0xD9.toByte(),
            0xED.toByte(), 0xFF.toByte(), 0xFF.toByte(), 0xFF.toByte()), IntroSkip.encode("Riley"))
    }

    @Test
    fun namesFitTheNativeSevenCharacterField() {
        assertArrayEquals(byteArrayOf(0xBB.toByte(), 0xBC.toByte(), 0xBD.toByte(), 0xBE.toByte(),
            0xBF.toByte(), 0xC0.toByte(), 0xC1.toByte(), 0xFF.toByte()), IntroSkip.encode("ABCDEFGH"))
        assertNull(IntroSkip.encode(" "))
    }
}
