package com.pokedaisy.app.journeys

import android.content.Context
import com.pokedaisy.app.companion.data.MonArt

/**
 * FOLLOWER in a GBA journey, drawn from the hub's Generation 8 Pack sheets (FollowerPackArt) when no hack's art was kept
 * (MonArt). The game wants six 32x32 4bpp frames (S, S', N, N', W, W'; east is west flipped) and a 16-colour palette.
 */
internal object FollowerGba {
    private const val FRAME = 32
    private val cache = java.util.concurrent.ConcurrentHashMap<Int, MonArt.Mon>()

    /** Cached only: the emu side asks this every time the lead changes. */
    fun cached(national: Int): MonArt.Mon? = cache[national]

    /** Blocking (IO): converts and caches [national]'s sheet; null when the pack lacks it. */
    fun prepare(context: Context, national: Int): MonArt.Mon? {
        cache[national]?.let { return it }
        val (frame, cells) = FollowerPackArt.frames(context, national) ?: return null
        val mon = convert(national, frame, cells) ?: return null
        cache[national] = mon
        return mon
    }

    /** [cells]: the pack's frames, row-major in its own order (down, left, right, up; four steps each). */
    private fun convert(national: Int, frame: Int, cells: List<IntArray>): MonArt.Mon? {
        // Stand and step facing south (down), north (up) and west (left).
        val picks = listOf(0, 1, 12, 13, 4, 5).map { cells[it] }
        val small = picks.map { to32(it, frame, picks) ?: return null }
        val colours = LinkedHashMap<Int, Int>()
        for (f in small) for (p in f) if (p ushr 24 >= 0x80) colours.merge(gba(p), 1, Int::plus)
        val palette = colours.entries.sortedByDescending { it.value }.take(15).map { it.key }
        if (palette.isEmpty()) return null
        fun index(p: Int): Int {
            if (p ushr 24 < 0x80) return 0
            val c = gba(p)
            val exact = palette.indexOf(c)
            if (exact >= 0) return exact + 1
            return palette.indices.minBy { dist(palette[it], c) } + 1
        }
        val frames = ByteArray(6 * FRAME * FRAME / 2)
        small.forEachIndexed { f, px ->
            for (y in 0 until FRAME) for (x in 0 until FRAME) {
                val v = index(px[y * FRAME + x])
                val i = f * 512 + ((y / 8) * 4 + x / 8) * 32 + (y % 8) * 4 + (x % 8) / 2
                frames[i] = (if (x % 2 == 0) (frames[i].toInt() and 0xF0) or v else (frames[i].toInt() and 0x0F) or (v shl 4)).toByte()
            }
        }
        val pal = ByteArray(32)
        palette.forEachIndexed { i, c -> pal[(i + 1) * 2] = c.toByte(); pal[(i + 1) * 2 + 1] = (c shr 8).toByte() }
        return MonArt.Mon(national, frames, pal, ByteArray(0x800), ByteArray(0x800), pal)
    }

    /**
     * A frame as 32x32: as it is at 32; at 64, the bottom-middle 32x32 when every frame's drawing fits there (feet on the
     * ground), else every other pixel.
     */
    private fun to32(px: IntArray, frame: Int, all: List<IntArray>): IntArray? = when (frame) {
        FRAME -> px
        FRAME * 2 -> {
            val fits = all.all { f -> (0 until frame * frame).all { i -> f[i] ushr 24 < 0x80 || (i % frame in 16 until 48 && i / frame >= 32) } }
            IntArray(FRAME * FRAME) { i ->
                val x = i % FRAME; val y = i / FRAME
                if (fits) px[(y + 32) * frame + x + 16] else px[(y * 2 + 1) * frame + x * 2]
            }
        }
        else -> null
    }

    private fun gba(argb: Int): Int = ((argb shr 19) and 31) or (((argb shr 11) and 31) shl 5) or (((argb shr 3) and 31) shl 10)

    private fun dist(a: Int, b: Int): Int {
        fun d(s: Int) = ((a shr s) and 31) - ((b shr s) and 31)
        return d(0) * d(0) + d(5) * d(5) + d(10) * d(10)
    }
}
