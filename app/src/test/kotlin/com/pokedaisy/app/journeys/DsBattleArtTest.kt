package com.pokedaisy.app.journeys

import com.pokedaisy.app.companion.data.DsPorts
import com.pokedaisy.app.companion.data.GameKind
import com.pokedaisy.app.companion.data.NdsArt
import com.pokedaisy.app.companion.data.RomArt
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.util.zip.InflaterInputStream

class DsBattleArtTest {
    private data class Cart(val file: File, val code: String, val revision: Int) {
        val gen4: Boolean get() = NdsArt.isHgss(code, revision) || NdsArt.isPlatinum(code, revision)
        val gen5: Boolean get() = revision == 0 && code in setOf("IREO", "IRDO", "IRBO", "IRBF", "IRAO", "IRAF") ||
            DsPorts.of(code, revision)?.kind in setOf(GameKind.BLACK2, GameKind.WHITE2, GameKind.BLACK, GameKind.WHITE)
    }

    private val carts by lazy {
        val root = File("C:/Projects/roms")
        if (!root.isDirectory) emptyList() else root.walkTopDown().filter { it.isFile && it.extension.equals("nds", true) }
            .mapNotNull { file ->
                runCatching {
                    RandomAccessFile(file, "r").use { f ->
                        f.seek(0x0C)
                        val code = ByteArray(4)
                        f.readFully(code)
                        f.seek(0x1E)
                        Cart(file, String(code, Charsets.US_ASCII), f.readUnsignedByte())
                    }
                }.getOrNull()
            }.toList()
    }

    private val previews = File("C:/Builds/PokeJourneys/ds-battle-preview")

    @Test
    fun gen4FrontBackAndShinyPictures() {
        val available = carts.filter { it.gen4 }
        assumeTrue("No supported Gen 4 cartridges in C:/Projects/roms", available.isNotEmpty())
        for (cart in available) checkPictures(cart, 80, listOf(1, 29, 386, 387, 448, 493))
    }

    @Test
    fun gen5FrontBackAndShinyPictures() {
        val available = carts.filter { it.gen5 }
        assumeTrue("No supported Gen 5 cartridges in C:/Projects/roms", available.isNotEmpty())
        for (cart in available) checkPictures(cart, 96, listOf(1, 29, 386, 494, 635, 649))
    }

    @Test
    fun prefersGen4ForOlderSpeciesAndGen5ForUnova() {
        val gen4 = carts.firstOrNull { it.gen4 }
        val gen5 = carts.firstOrNull { it.gen5 }
        assumeTrue("Both supported generations are needed", gen4 != null && gen5 != null)
        withCache { files ->
            val older = DsBattleArt(files) { listOf(gen4!!.file) }
            val newer = DsBattleArt(files) { listOf(gen5!!.file) }
            val mixed = DsBattleArt(files) { listOf(gen5!!.file, gen4!!.file) }
            for (species in listOf(1, 387)) {
                assertArrayEquals(older.picture(species, false, false), mixed.picture(species, false, false))
            }
            assertArrayEquals(newer.picture(494, true, true), mixed.picture(494, true, true))
            assertNull(older.picture(494, false, false))
            assertNull(mixed.picture(0, false, false))
            assertNull(mixed.picture(650, false, false))
            assertNull(mixed.picture(807, false, false))
        }
    }

    @Test
    fun prefersBlack2ToBlackRegardlessOfLibraryOrder() {
        val black2 = carts.firstOrNull { it.code == "IREO" && it.revision == 0 }
        val black = carts.firstOrNull { it.code == "IRBO" && it.revision == 0 }
        assumeTrue("Black 2 and Black cartridges are needed", black2 != null && black != null)
        withCache { files ->
            val mixed = DsBattleArt(files) { listOf(black!!.file, black2!!.file) }
            assertNotNull(mixed.picture(649, true, true))
            val pictures = RomArt.dir(files).walkTopDown().filter { it.extension == "png" }.toList()
            assertEquals(1, pictures.size)
            assertTrue(pictures.single().invariantSeparatorsPath.contains("nds/black2/battle/"))
        }
    }

    private fun checkPictures(cart: Cart, size: Int, species: List<Int>) {
        withCache { files ->
            val art = DsBattleArt(files) { listOf(cart.file) }
            val out = File(previews, "${cart.code}-${cart.revision}").apply { mkdirs() }
            for (id in species) {
                val views = mutableListOf<IntArray>()
                for (back in listOf(false, true)) {
                    val palettes = mutableListOf<IntArray>()
                    for (shiny in listOf(false, true)) {
                        val name = "$id-${if (back) "back" else "front"}${if (shiny) "-shiny" else ""}.png"
                        val png = art.picture(id, back, shiny)
                        assertNotNull("${cart.code}: $name", png)
                        val pixels = pixels(png!!, size)
                        assertTrue(name, pixels.count { it and 255 == 255 } > 20)
                        assertTrue(name, pixels.count { it and 255 == 0 } > 20)
                        assertTrue(name, pixels.toSet().size > 3)
                        File(out, name).writeBytes(png)
                        palettes.add(pixels)
                        val cached = DsBattleArt(files) { listOf(cart.file) }.picture(id, back, shiny)
                        assertArrayEquals("Cached $name", png, cached)
                    }
                    assertFalse("Shiny palette for $id", palettes[0].contentEquals(palettes[1]))
                    assertArrayEquals(palettes[0].map { it and 255 }.toIntArray(), palettes[1].map { it and 255 }.toIntArray())
                    views.add(palettes[0])
                }
                assertFalse("Front and back for $id", views[0].contentEquals(views[1]))
            }
            val pictures = RomArt.dir(files).walkTopDown().filter { it.extension == "png" }.toList()
            assertEquals("Only requested pictures are cached", species.size * 4, pictures.size)
        }
    }

    private fun pixels(png: ByteArray, size: Int): IntArray {
        val buffer = ByteBuffer.wrap(png)
        assertEquals(0x89504E470D0A1A0AuL.toLong(), buffer.long)
        assertEquals(size, buffer.getInt(16))
        assertEquals(size, buffer.getInt(20))
        assertEquals(8, png[24].toInt())
        assertEquals(6, png[25].toInt())
        val compressed = ByteArrayOutputStream()
        var at = 8
        while (at + 12 <= png.size) {
            val length = buffer.getInt(at)
            if (String(png, at + 4, 4, Charsets.US_ASCII) == "IDAT") compressed.write(png, at + 8, length)
            at += length + 12
        }
        val raw = InflaterInputStream(ByteArrayInputStream(compressed.toByteArray())).use { it.readBytes() }
        val stride = 1 + size * 4
        assertEquals(size * stride, raw.size)
        val rgba = ByteBuffer.wrap(raw)
        for (y in 0 until size) assertEquals(0, raw[y * stride].toInt())
        return IntArray(size * size) { i -> rgba.getInt((i / size) * stride + 1 + (i % size) * 4) }
    }

    private fun withCache(check: (File) -> Unit) {
        previews.mkdirs()
        val files = java.nio.file.Files.createTempDirectory(previews.toPath(), "cache-").toFile()
        try {
            check(files)
        } finally {
            files.deleteRecursively()
        }
    }
}
