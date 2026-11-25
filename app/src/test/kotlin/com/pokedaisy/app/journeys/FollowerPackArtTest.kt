package com.pokedaisy.app.journeys

import org.junit.Assert.assertEquals
import org.junit.Test

class FollowerPackArtTest {
    @Test
    fun convertsFourDirectionsAndKeepsLargeSpritesAtNativeSize() {
        val size = 512
        val cell = size / 4
        val frame = cell / 2
        val pixels = IntArray(size * size)
        for (row in 0 until 4) for (column in 0 until 4) {
            for (y in 0 until frame) for (x in 0 until frame) {
                pixels[(row * cell + y * 2) * size + column * cell + x * 2] = pixel(row, column, x, y)
            }
        }
        val strip = FollowerPackArt.packFrames(size, pixels)
        assertEquals(frame, strip.height)
        assertEquals(frame * 16, strip.width)
        for ((direction, row) in listOf(3, 0, 1, 2).withIndex()) {
            for (column in 0 until 4) {
                val first = (direction * 4 + column) * frame
                assertEquals(pixel(row, column, 0, 0), strip.argb[first])
                assertEquals(pixel(row, column, 63, 63), strip.argb[63 * strip.width + first + 63])
            }
        }
    }

    private fun pixel(row: Int, column: Int, x: Int, y: Int): Int =
        0xFF000000.toInt() or (row shl 20) or (column shl 16) or (y shl 8) or x
}
