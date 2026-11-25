package com.pokedaisy.app.journeys

import android.graphics.BitmapFactory
import com.pokedaisy.app.companion.data.RomArt
import java.io.File

/** A medal and its crest drawn at the trainer card's native resolution. */
internal object StadiumRankBadge {
    const val SHEET_NAME = "versus-badges.png"
    private const val SHEET_WIDTH = 260
    private const val SHEET_HEIGHT = 846
    private const val CELL_WIDTH = 32
    private const val CELL_HEIGHT = 30
    private const val PALETTE_HEIGHT = 136

    private const val CENTER_X = 19
    private const val CENTER_Y = 12
    private const val OUTLINE = 0x263043
    private const val CREST = 0xFFF4D8

    private val stars = listOf(
        emptyList(),
        listOf(0 to 0),
        listOf(-4 to 0, 4 to 0),
        listOf(0 to -4, -4 to 3, 4 to 3),
        listOf(-4 to -4, 4 to -4, -4 to 4, 4 to 4),
        listOf(-5 to -5, 5 to -5, 0 to 0, -5 to 5, 5 to 5),
        listOf(-6 to -4, 0 to -4, 6 to -4, -6 to 4, 0 to 4, 6 to 4),
    )
    private val starPixels = listOf(0 to -2, -2 to 0, -1 to 0, 0 to 0, 1 to 0, 2 to 0, 0 to -1, -1 to 1, 0 to 1, 1 to 1)

    private val wing = listOf(
        "##............",
        "#+##..........",
        ".#++###.......",
        ".##+++=###....",
        "..###++===####",
        "..#++#+++====#",
        "...##+###++==#",
        ".....#+++####.",
        "......###.....",
    )

    fun load(hubData: File, badge: StadiumRank.Badge): RomArt.Image {
        val sheetFile = File(hubData, SHEET_NAME)
        if (!sheetFile.isFile) return draw(badge)
        val bitmap = BitmapFactory.decodeFile(sheetFile.path) ?: return draw(badge)
        try {
            if (bitmap.width != SHEET_WIDTH || bitmap.height != SHEET_HEIGHT) return draw(badge)
            val sheet = RomArt.Image(bitmap.width, bitmap.height)
            bitmap.getPixels(sheet.argb, 0, sheet.width, 0, 0, sheet.width, sheet.height)
            return fromSheet(sheet, badge) ?: draw(badge)
        } finally {
            bitmap.recycle()
        }
    }

    fun fromSheet(sheet: RomArt.Image, badge: StadiumRank.Badge): RomArt.Image? {
        if (sheet.width != SHEET_WIDTH || sheet.height != SHEET_HEIGHT) return null
        // Sample the grid and a blank part of the first cell after PNG color conversion.
        val gridColor = sheet.argb[0]
        val cellColor = sheet.argb[6 * sheet.width + 2]
        val band = when (badge.tier) {
            StadiumRank.Tier.BRONZE -> 0
            StadiumRank.Tier.SILVER -> 5
            StadiumRank.Tier.GOLD -> 4
            StadiumRank.Tier.DIAMOND -> 1
        }
        val x = if (badge.stars == 6) 194 else 2 + (badge.stars - 1).coerceAtLeast(0) * CELL_WIDTH
        val y = band * PALETTE_HEIGHT + if (badge.stars == 0) 3 else 106
        val emblem = RomArt.Image(CELL_WIDTH, CELL_HEIGHT)
        for (row in 0 until CELL_HEIGHT) for (col in 0 until CELL_WIDTH) {
            val pixel = sheet.argb[(y + row) * sheet.width + x + col]
            if (pixel != gridColor && pixel != cellColor) emblem.argb[row * CELL_WIDTH + col] = pixel
        }
        return emblem.takeIf { it.argb.any { pixel -> pixel ushr 24 != 0 } }
    }

    fun draw(badge: StadiumRank.Badge): RomArt.Image {
        val (light, fill, shade) = when (badge.tier) {
            StadiumRank.Tier.BRONZE -> Triple(0xF4BA86, 0xC97849, 0x9E4C38)
            StadiumRank.Tier.SILVER -> Triple(0xDCF4F3, 0x819FAA, 0x567480)
            StadiumRank.Tier.GOLD -> Triple(0xFFE596, 0xDAA332, 0xA9711C)
            StadiumRank.Tier.DIAMOND -> Triple(0xA4E4FD, 0x4D9BD4, 0x326DA9)
        }
        val image = RomArt.Image(2 * CENTER_X + 1, 2 * CENTER_Y + 1)
        fun pixel(x: Int, y: Int, color: Int) {
            image.argb[y * image.width + x] = color or 0xFF000000.toInt()
        }

        if (badge.stars == 6) {
            for ((y, row) in wing.withIndex()) for ((x, mark) in row.withIndex()) {
                val color = when (mark) {
                    '#' -> OUTLINE
                    '+' -> CREST
                    '=' -> light
                    else -> continue
                }
                pixel(x, y + 7, color)
                pixel(image.width - 1 - x, y + 7, color)
            }
        }

        for (y in -11..11) for (x in -11..11) {
            val distance = x * x + y * y
            val color = when {
                distance > 121 -> continue
                distance > 100 -> OUTLINE
                distance > 81 -> if (x + y < 0) light else shade
                distance > 64 -> shade
                else -> fill
            }
            pixel(CENTER_X + x, CENTER_Y + y, color)
        }

        if (badge.stars == 0) {
            for (y in -6..6) for (x in -6..6) {
                val distance = x * x + y * y
                val color = when {
                    distance > 36 -> continue
                    distance <= 2 -> CREST
                    distance <= 5 || y == 0 || distance > 25 -> OUTLINE
                    y < 0 -> light
                    else -> CREST
                }
                pixel(CENTER_X + x, CENTER_Y + y, color)
            }
        } else {
            for ((x, y) in stars[badge.stars]) {
                for ((dx, dy) in starPixels) {
                    pixel(CENTER_X + x + dx, CENTER_Y + y + dy, CREST)
                }
            }
        }
        return image
    }
}
