package com.pokedaisy.app.journeys

import android.content.Context
import com.pokedaisy.app.RomIdentity
import com.pokedaisy.app.companion.data.PlayerLook
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.time.LocalDateTime
import java.util.zip.CRC32
import kotlin.math.max
import kotlin.math.min

/** The hub's walking character fitted to the GB games' six 16x16, two-bit sprite frames. */
internal object CreatorLookGb {
    fun build(context: Context, rom: File, fresh: Boolean): PlayerLook.Patch? {
        val game = GbJourney.games[RomIdentity.sha1(rom)] ?: return null
        val look = CreatorLook.saved(context.filesDir) ?: return null
        val art = CreatorLook.apkArt(context)
        CreatorLook.hero(art, look)?.let { CreatorLook.keep(context.filesDir, it) }
        val pixels = CreatorLook.canvas(art, look, "walk")
        return build(game, rom.readBytes(), look, pixels, fresh, LocalDateTime.now())
    }

    internal fun build(game: GbJourney.Game, rom: ByteArray, look: JSONObject, pixels: IntArray,
                       fresh: Boolean, time: LocalDateTime): PlayerLook.Patch? {
        val blocks = mutableListOf<PlayerLook.Block>()
        fun block(offset: Int, bytes: ByteArray) {
            require(offset >= 0 && offset + bytes.size <= rom.size)
            val crc = CRC32().apply { update(rom, offset, bytes.size) }.value.toInt()
            blocks += PlayerLook.Block(offset, crc, bytes)
        }
        val sprite = sprite(pixels) ?: return null
        for (offset in game.sprites) block(offset, sprite)
        if (fresh) {
            val name = GbJourney.encode(look.optString("name"))
            if (name[0] == 0x50.toByte()) return null
            if (game.generation == 1) {
                val pointer = (game.prepare until game.speech - 5).singleOrNull { at ->
                    rom[at] == 0x21.toByte() && rom[at + 3] == 0x11.toByte() &&
                        word(rom, at + 4) == game.name
                } ?: return null
                val branch = (game.speech until game.skip - 2).singleOrNull { at ->
                    rom[at] == 0xC2.toByte() && word(rom, at + 1) == game.skip
                } ?: return null
                val rivalPointer = (game.prepare until game.speech - 5).singleOrNull { at ->
                    rom[at] == 0x21.toByte() && rom[at + 3] == 0x11.toByte() &&
                        word(rom, at + 4) == game.rivalName
                } ?: return null
                val text = game.speech + 0x80
                block(text, name)
                block(pointer, byteArrayOf(0x21, text.toByte(), (text shr 8).toByte()))
                val rivalText = game.speech + 0x90
                block(rivalText, GbJourney.encode("Blue"))
                block(rivalPointer, byteArrayOf(0x21, rivalText.toByte(), (rivalText shr 8).toByte()))
                block(branch, byteArrayOf(0xC3.toByte()))
                val cleanup = ByteArrayOutputStream()
                call(cleanup, game.resetSprite)
                call(cleanup, game.loadFont)
                store(cleanup, game.spriteUpdates, 1)
                cleanup.write(byteArrayOf(0xC3.toByte(), game.clearScreen.toByte(), (game.clearScreen shr 8).toByte()))
                block(game.skip, cleanup.toByteArray())
            } else {
                val code = ByteArrayOutputStream()
                for ((index, value) in name.withIndex()) store(code, (game.name and 0xFFFF) + index, value.toInt())
                val clock = intArrayOf(time.dayOfWeek.value % 7, time.hour, time.minute, time.second)
                for ((index, value) in clock.withIndex()) store(code, game.clockBuffer + index, value)
                call(code, game.initTime)
                code.write(0xC9)
                block(game.speech, code.toByteArray())
                if (game.profile != 0) {
                    val profile = ByteArrayOutputStream()
                    store(profile, game.gender, if (look.optString("gender", "m") == "f") 1 else 0)
                    profile.write(0xC9)
                    block(game.profile, profile.toByteArray())
                }
            }
        }
        return PlayerLook.Patch(blocks, emptyList())
    }

    internal fun sprite(pixels: IntArray): ByteArray? {
        if (pixels.size != 128 * 128) return null
        var left = 32
        var top = 32
        var right = -1
        var bottom = -1
        for (y in 0 until 128) for (x in 0 until 128) {
            if (pixels[y * 128 + x] ushr 24 < 128) continue
            left = min(left, x % 32)
            right = max(right, x % 32)
            top = min(top, y % 32)
            bottom = max(bottom, y % 32)
        }
        if (right < left || bottom < top) return null
        val width = right - left + 1
        val height = bottom - top + 1
        val scale = min(16.0 / width, 16.0 / height)
        val drawWidth = max(1, (width * scale).toInt())
        val drawHeight = max(1, (height * scale).toInt())
        val xOffset = (16 - drawWidth) / 2
        val yOffset = 16 - drawHeight
        val out = ByteArrayOutputStream()
        for (step in 0..1) for (row in intArrayOf(0, 3, 1)) {
            val frame = IntArray(256)
            for (y in 0 until drawHeight) for (x in 0 until drawWidth) {
                val sx = left + min(width - 1, ((x + 0.5) / scale).toInt())
                val sy = top + min(height - 1, ((y + 0.5) / scale).toInt())
                val color = pixels[(row * 32 + sy) * 128 + step * 32 + sx]
                if (color ushr 24 < 128) continue
                val light = ((color shr 16) and 255) * 299 + ((color shr 8) and 255) * 587 + (color and 255) * 114
                frame[(yOffset + y) * 16 + xOffset + x] = when {
                    light >= 170_000 -> 1
                    light >= 80_000 -> 2
                    else -> 3
                }
            }
            for (tileY in 0..1) for (tileX in 0..1) for (y in 0..7) {
                var low = 0
                var high = 0
                for (x in 0..7) {
                    val color = frame[(tileY * 8 + y) * 16 + tileX * 8 + x]
                    low = low or ((color and 1) shl (7 - x))
                    high = high or (((color shr 1) and 1) shl (7 - x))
                }
                out.write(low)
                out.write(high)
            }
        }
        return out.toByteArray()
    }

    private fun word(bytes: ByteArray, offset: Int) =
        (bytes[offset].toInt() and 255) or ((bytes[offset + 1].toInt() and 255) shl 8)
    private fun store(code: ByteArrayOutputStream, address: Int, value: Int) {
        code.write(byteArrayOf(0x3E, value.toByte(), 0xEA.toByte(), address.toByte(), (address shr 8).toByte()))
    }
    private fun call(code: ByteArrayOutputStream, address: Int) {
        code.write(byteArrayOf(0xCD.toByte(), address.toByte(), (address shr 8).toByte()))
    }
}
