package com.pokedaisy.app.journeys

import android.content.Context
import android.graphics.BitmapFactory
import com.pokedaisy.app.companion.data.RomArt
import java.io.File

/**
 * Follower sheets from the Generation 8 Pack: a local copy in the hub data (hub-data/followers) when there is one,
 * else the copy bundled in the app (assets/followers; credited in CREDITS.md, NOTICE and the licenses screen).
 */
internal object FollowerPackArt {
    private const val GRID = 4
    private const val SOURCE_PIXEL = 2
    private const val NORMAL = "Followers"
    private const val SHINY = "Followers shiny"
    private val directionRows = intArrayOf(3, 0, 1, 2)
    private val spriteName = Regex("[A-Za-z0-9]+")

    fun load(context: Context, id: String): ByteArray? {
        val appearance = JourneysBridge.run(context, "follower-art", id)
        if (!appearance.ok) return null
        val parts = appearance.output.split('\t')
        if (parts.size != 3 || !spriteName.matches(parts[0])) return null
        val (name, isShiny, isFemale) = parts
        val folders = if (isShiny == "1") listOf(SHINY, NORMAL) else listOf(NORMAL)
        val names = if (isFemale == "1") listOf("${name}_female.png", "$name.png") else listOf("$name.png")
        return folders.firstNotNullOfOrNull { folder ->
            names.firstNotNullOfOrNull { file -> decode(read(context, folder, file)) }
        }
    }

    private val sheetNames = java.util.concurrent.ConcurrentHashMap<Int, String>()

    /** Another player's follower by National Pokédex number (bots' too), or null when the pack lacks it. */
    fun forSpecies(context: Context, species: Int, isShiny: Boolean): ByteArray? {
        val name = sheetNames[species] ?: JourneysBridge.run(context, "follower-sprite", species.toString())
            .takeIf { it.ok && spriteName.matches(it.output) }?.output?.also { sheetNames[species] = it } ?: return null
        val folders = if (isShiny) listOf(SHINY, NORMAL) else listOf(NORMAL)
        return folders.firstNotNullOfOrNull { folder -> decode(read(context, folder, "$name.png")) }
    }

    /** One sheet's PNG: the local pack's file, else the bundled one. */
    private fun read(context: Context, folder: String, file: String): ByteArray? {
        val local = File(File(File(HubActivity.dataDir(context), "followers"), folder), file)
        if (local.isFile) return runCatching { local.readBytes() }.getOrNull()
        return runCatching { context.assets.open("followers/$folder/$file").use { it.readBytes() } }.getOrNull()
    }

    private fun decode(png: ByteArray?): ByteArray? {
        if (png == null) return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(png, 0, png.size, bounds)
        val size = bounds.outWidth
        if (size !in 128..512 || bounds.outHeight != size || size % (GRID * SOURCE_PIXEL) != 0) return null
        val bitmap = BitmapFactory.decodeByteArray(png, 0, png.size) ?: return null
        val pixels = IntArray(size * size)
        try {
            if (bitmap.width != size || bitmap.height != size) return null
            bitmap.getPixels(pixels, 0, size, 0, 0, size, size)
        } finally {
            bitmap.recycle()
        }
        val strip = packFrames(size, pixels)
        return strip.takeIf { it.argb.any { pixel -> pixel ushr 24 != 0 } }?.png()
    }

    /** The pack is down, left, right, up. The hub animates a strip in up, down, left, right order. */
    internal fun packFrames(size: Int, pixels: IntArray): RomArt.Image {
        val cell = size / GRID
        val frame = cell / SOURCE_PIXEL
        val strip = RomArt.Image(GRID * GRID * frame, frame)
        for ((direction, row) in directionRows.withIndex()) {
            for (column in 0 until GRID) {
                val frameStart = (direction * GRID + column) * frame
                for (y in 0 until frame) {
                    val input = (row * cell + y * SOURCE_PIXEL) * size + column * cell
                    val output = y * strip.width + frameStart
                    for (x in 0 until frame) strip.argb[output + x] = pixels[input + x * SOURCE_PIXEL]
                }
            }
        }
        return strip
    }
}
