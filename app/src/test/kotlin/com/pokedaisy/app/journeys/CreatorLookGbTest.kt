package com.pokedaisy.app.journeys

import org.junit.Assert.*
import org.junit.Test

class CreatorLookGbTest {
    @Test fun sixFramesUseTheGamesDirectionOrderAndTwoBitPlanes() {
        val canvas = IntArray(128 * 128)
        for (step in 0..1) for ((row, color) in listOf(0 to 0xFFFFFFFF.toInt(), 3 to 0xFF999999.toInt(), 1 to 0xFF111111.toInt())) {
            for (y in 16..31) for (x in 8..23) canvas[(row * 32 + y) * 128 + step * 32 + x] = color
        }
        val tiles = checkNotNull(CreatorLookGb.sprite(canvas))
        assertEquals(384, tiles.size)
        for (frame in 0..5) for (row in 0..31) {
            val shade = frame % 3 + 1
            assertEquals(if (shade and 1 != 0) 255 else 0, tiles[frame * 64 + row * 2].toInt() and 255)
            assertEquals(if (shade and 2 != 0) 255 else 0, tiles[frame * 64 + row * 2 + 1].toInt() and 255)
        }
    }
    @Test fun emptyArtIsRejectedAndNamesHaveASevenCharacterLimit() {
        assertNull(CreatorLookGb.sprite(IntArray(128 * 128)))
        assertNull(CreatorLookGb.sprite(IntArray(32)))
        val name = GbJourney.encode("Riley-1234")
        assertArrayEquals(byteArrayOf(0x91.toByte(), 0xA8.toByte(), 0xAB.toByte(), 0xA4.toByte(), 0xB8.toByte(), 0xE3.toByte(), 0xF7.toByte(), 0x50), name)
        assertArrayEquals(byteArrayOf(0x91.toByte(), 0xA8.toByte(), 0xAB.toByte(), 0xA4.toByte(), 0xB8.toByte(), 0x50, 0x50, 0x50), GbJourney.encode(" Riley "))
    }
}
