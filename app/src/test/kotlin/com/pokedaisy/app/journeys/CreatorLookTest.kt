package com.pokedaisy.app.journeys

import com.pokedaisy.app.companion.data.LOOK_SHARED_COLOURS
import com.pokedaisy.app.companion.data.LookChar
import com.pokedaisy.app.companion.data.LookPart
import com.pokedaisy.app.companion.data.PlayerLook
import com.pokedaisy.app.companion.data.RETAIL_ROM_DIR
import com.pokedaisy.app.companion.data.RomArt
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.RandomAccessFile

/**
 * The creator's look as PLAYER LOOK ([CreatorLook], [CreatorLookDs]) from the repo's assets/creator: a few looks built
 * into each ROM here, the Gen 3 patches written to app/build/creator-look/ (mgba_dump's `romblocks` format) with a
 * preview of every sheet and picture the patch writes, drawn in the palettes it puts in. Skips a ROM that isn't here.
 */
class CreatorLookTest {
    private val root = listOf(File("../assets/creator/sprites"), File("assets/creator/sprites")).firstOrNull { it.isDirectory } ?: File("../assets/creator/sprites")

    private val art = object : CreatorLook.Art {
        override fun list(dir: String) = File(root, dir).list()?.toList().orEmpty()
        override fun load(path: String) = File(root, path).takeIf { it.isFile }?.let { readPng(it.readBytes()) }
    }

    private val looks = mapOf(
        "youngster" to """{"gender":"m","skin":"light","hair":["Short 4","brown"],"top":["T Shirt","blue"],"bottom":["Shorts","grey"],"hat":["Youngster Hat","grey"],"bag":["None",""]}""",
        "default" to """{"gender":"m","skin":"light","hair":["Short 2","brown"],"top":["Vest","blue"],"bottom":["Shorts","red"],"hat":["None",""],"bag":["None",""]}""",
        "girl" to """{"gender":"f","skin":"medium","hair":["Long 2","pink"],"top":["Vest","teal"],"bottom":["Capris","black"],"hat":["None",""],"bag":["None",""]}""",
        "hat" to """{"gender":"m","skin":"dark","hair":["Short 1","black"],"top":["Hoodie","red"],"bottom":["Jeans","blue"],"hat":["Beanie","green"],"bag":["None",""]}""",
    )

    private val gba = mapOf(
        "emerald" to ("Pokemon - Emerald Version (USA, Europe).gba" to "BPE"),
        "firered" to ("Pokemon - FireRed Version (USA, Europe) (Rev 1).gba" to "BPR"),
    )
    private val nds = mapOf(
        "platinum" to "Pokemon Platinum Version (US)(XenoPhobia).nds",
        "heartgold" to "Pokemon HeartGold (U)(Xenophobia).nds",
        "black" to "Pokemon - Black.nds",
        "black2" to "Pokemon - Black 2.nds",
    )

    private val out = File("build/creator-look").apply { mkdirs() }

    @Test
    fun patchGameBoyJourneys() {
        val dir = System.getProperty("gbRomDir") ?: return
        val look = JSONObject(looks.getValue("girl")).put("name", "Riley")
        val canvas = CreatorLook.canvas(art, look, "walk")
        for (title in listOf("red", "blue", "yellow", "gold", "silver", "crystal")) {
            val file = File(dir, "$title.gb")
            val rom = file.readBytes()
            val identity = java.security.MessageDigest.getInstance("SHA-1").digest(rom).joinToString("") { "%02x".format(it) }
            val game = checkNotNull(GbJourney.games[identity])
            for (fresh in listOf(false, true)) {
                val patch = checkNotNull(CreatorLookGb.build(game, rom, look, canvas, fresh, java.time.LocalDateTime.of(2026, 11, 17, 12, 0)))
                assertEquals(game.sprites.size, patch.blocks.count { it.data.size == 384 })
                if (!fresh) assertEquals(game.sprites.size, patch.blocks.size)
                for (block in patch.blocks) assertEquals(block.crc, java.util.zip.CRC32().apply { update(rom, block.off, block.data.size) }.value.toInt())
                assertTrue(patch.blocks.indices.all { i -> patch.blocks.indices.all { j ->
                    i == j || patch.blocks[i].let { a -> patch.blocks[j].let { b -> a.off + a.data.size <= b.off || b.off + b.data.size <= a.off } }
                } })
                File(out, "$title-${if (fresh) "fresh" else "existing"}.txt").writeText(patch.blocks.joinToString("\n") {
                    "block %08X %08X %s".format(it.off, it.crc, it.data.joinToString("") { b -> "%02x".format(b) })
                })
            }
        }
    }

    @Test
    fun heroHasEveryPartInEmeraldsSizes() {
        val hero = CreatorLook.hero(art, JSONObject(looks["default"]!!))
        assertNotNull(hero)
        val sizes = mapOf(
            LookPart.EM_WALKING to 9, LookPart.EM_RUNNING to 9, LookPart.EM_MACH_BIKE to 9, LookPart.EM_ACRO_BIKE to 27,
            LookPart.EM_SURFING to 6, LookPart.EM_FIELD_MOVE to 5, LookPart.EM_FISHING to 12, LookPart.EM_WATERING to 6,
            LookPart.EM_DECORATING to 1, LookPart.BACK to 4,
        )
        for ((p, n) in sizes) assertEquals(p.name, n * p.frameBytes, hero!![p]?.size)
        assertEquals(2048, hero!![LookPart.FRONT]?.size)
        for ((name, json) in looks) preview(File(out, "hero-$name.png"), CreatorLook.hero(art, JSONObject(json))!!)
    }

    @Test
    fun hubPortraitUsesSavedTShirtAndKeepsTheTopOfTheHat() {
        val look = JSONObject(looks.getValue("youngster"))
            .put("skin", "pale")
            .put("bottom", JSONArray().put("Jumpsuit Pants Alt").put("grey"))
            .put("top", JSONArray().put("T Shirt").put("navy"))
        val navy = cardPortrait(look)
        val red = cardPortrait(look.put("top", JSONArray().put("T Shirt").put("red")))
        assertTrue("Changing the selected shirt colour changes the portrait", !navy.contentEquals(red))
        assertTrue("The hat reaches the top row", navy.take(64).any { it != 0 })
        assertTrue("The feet fit above the bottom margin", navy.slice(61 * 64 until 62 * 64).any { it != 0 })
        assertTrue("The portrait fits the narrow card window", navy.withIndex().none { (i, pixel) -> pixel != 0 && i % 64 >= 58 })
    }

    @Test
    fun hubPortraitUsesTheOutfitWhenTheTopHasNoFrontArt() {
        val look = JSONObject(looks.getValue("youngster"))
        val blue = cardPortrait(look.put("top", JSONArray().put("Adventurer Tunic").put("blue")))
        val red = cardPortrait(look.put("top", JSONArray().put("Adventurer Tunic").put("red")))
        assertTrue("The overworld portrait still shows the selected top", !blue.contentEquals(red))
    }

    private fun cardPortrait(look: JSONObject): IntArray {
        val (tiles, palette) = checkNotNull(CreatorLook.hubFrontPic(art, look))
        return RomArt.sprite(tiles, RomArt.palette(palette), 64, 64).argb
    }

    @Test
    fun patchEveryGbaRom() {
        for ((key, rom) in gba) {
            val file = File(RETAIL_ROM_DIR + rom.first).takeIf { it.isFile } ?: continue
            val scan = PlayerLook.scan(file.readBytes())
            val engine = PlayerLook.engineFor(rom.second)!!
            for ((lookName, json) in looks) {
                for (female in listOf(false, true)) {
                    val me = LookChar.of(engine, female)
                    val hero = CreatorLook.hero(art, JSONObject(json), CreatorLook.sharedColours(scan, me))!!
                    val narrow = CreatorLook.build(scan, me, hero)
                    val patch = CreatorLook.build(scan, me, hero, wide = CreatorLook.wideFrames(art, JSONObject(json), hero))
                    assertNotNull("$key $lookName $me", patch)
                    // The walking / running records made 32x32: the 18 frames and a table in the tail, the records' fields.
                    val more = patch!!.blocks.sumOf { it.data.size } - narrow!!.blocks.sumOf { it.data.size }
                    println("$key $lookName $me: 32x32 records add $more bytes")
                    assertTrue("$key $me: records widened", more >= 18 * 512)
                    val pal = patch!!.playerPal!!
                    val own = scan.data(me, LookPart.OW_PAL)!!
                    for (s in LOOK_SHARED_COLOURS[engine]!!) assertEquals(own[s * 2] to own[s * 2 + 1], pal[s * 2] to pal[s * 2 + 1])
                    File(out, "$key-${me.name.lowercase()}-$lookName.txt").writeText(patch.toText())
                    // The sheets as the patched ROM has them, in the worn palette.
                    val patched = scan.rom.copyOf().also { r -> patch.blocks.forEach { b -> b.data.copyInto(r, b.off) } }
                    val parts = LookPart.entries.filter { it.w > 0 && it != LookPart.BACK }.mapNotNull { p ->
                        PlayerLook.blob(me, p)?.takeIf { !it.lz }?.let { b -> scan.hitsOf(me, p).firstOrNull()?.let { p to patched.copyOfRange(it, it + b.size) } }
                    }.toMap()
                    preview(File(out, "$key-${me.name.lowercase()}-$lookName.png"), parts + (LookPart.OW_PAL to pal))
                }
            }
        }
    }

    @Test
    fun patchEveryDsRom() {
        val canvases = listOf("walk", "run", "bike").associateWith { CreatorLook.canvas(art, JSONObject(looks["default"]!!), it) }
        for ((key, name) in nds) {
            val file = File(RETAIL_ROM_DIR + name).takeIf { it.isFile } ?: continue
            for (female in listOf(false, true)) {
                val patch = RandomAccessFile(file, "r").use { CreatorLookDs.build(it, { m -> canvases.getValue(m) }, female) }
                // Both textures' frames and palettes: 2 palettes of 32 bytes, the rest 512-byte frames.
                assertEquals("$key palettes", 2, patch?.blocks?.count { it.data.size == 32 })
                println("$key female=$female: ${patch?.blocks?.count { it.data.size == 512 }} frames")
                assertNotNull("$key female=$female", patch)
                assertTrue(patch!!.blocks.isNotEmpty())
                RandomAccessFile(file, "r").use { f ->
                    for (b in patch.blocks) {
                        val under = ByteArray(b.data.size).also { f.seek(b.off.toLong()); f.readFully(it) }
                        assertEquals(java.util.zip.CRC32().apply { update(under) }.value.toInt(), b.crc)
                    }
                }
                File(out, "$key-${if (female) "girl" else "boy"}.txt").writeText(patch.toText())
            }
        }
    }

    /** Every sheet of [parts] a row, frames side by side, 3x, in [LookPart.OW_PAL] (pictures in [LookPart.BACK_PAL]). */
    private fun preview(f: File, parts: Map<LookPart, ByteArray>) {
        val owPal = RomArt.palette(parts[LookPart.OW_PAL] ?: return)
        val picPal = parts[LookPart.BACK_PAL]?.let { RomArt.palette(it) } ?: owPal
        val rows = LookPart.entries.filter { (it.w > 0 || it == LookPart.FRONT) && parts[it] != null }.map { p ->
            val w = if (p == LookPart.FRONT) 8 else p.w; val h = if (p == LookPart.FRONT) 8 else p.h
            val fb = w * h * 32
            val d = parts[p]!!
            (0 until d.size / fb).map { RomArt.sprite(d.copyOfRange(it * fb, (it + 1) * fb), if (p == LookPart.BACK || p == LookPart.FRONT) picPal else owPal, w * 8, h * 8) }
        }
        val width = rows.maxOf { r -> r.sumOf { it.width + 2 } }
        val height = rows.sumOf { r -> r.maxOf { it.height } + 2 }
        val k = 3
        val img = RomArt.Image(width * k, height * k)
        img.argb.fill(0xFFB0D8B0.toInt())
        var y = 0
        for (r in rows) {
            var x = 0
            for (s in r) {
                for (yy in 0 until s.height) for (xx in 0 until s.width) {
                    val c = s.argb[yy * s.width + xx]
                    if (c != 0) for (j in 0 until k * k) img.argb[((y + yy) * k + j / k) * img.width + (x + xx) * k + j % k] = c
                }
                x += s.width + 2
            }
            y += r.maxOf { it.height } + 2
        }
        f.writeBytes(img.png())
    }

    /** A PNG as ARGB (8-bit greyscale, RGB, RGBA or indexed at any depth, tRNS honoured). */
    private fun readPng(b: ByteArray): CreatorLook.Img {
        fun u32(o: Int) = ((b[o].toInt() and 0xFF) shl 24) or ((b[o + 1].toInt() and 0xFF) shl 16) or ((b[o + 2].toInt() and 0xFF) shl 8) or (b[o + 3].toInt() and 0xFF)
        var o = 8
        var w = 0; var h = 0; var depth = 8; var type = 6
        var plte = ByteArray(0); var trns = ByteArray(0)
        val idat = java.io.ByteArrayOutputStream()
        while (o < b.size) {
            val len = u32(o); val t = String(b, o + 4, 4, Charsets.US_ASCII); val d = o + 8
            when (t) {
                "IHDR" -> { w = u32(d); h = u32(d + 4); depth = b[d + 8].toInt(); type = b[d + 9].toInt() }
                "PLTE" -> plte = b.copyOfRange(d, d + len)
                "tRNS" -> trns = b.copyOfRange(d, d + len)
                "IDAT" -> idat.write(b, d, len)
            }
            o += 12 + len
        }
        val raw = java.util.zip.InflaterInputStream(idat.toByteArray().inputStream()).readBytes()
        val channels = when (type) { 0 -> 1; 2 -> 3; 3 -> 1; 4 -> 2; else -> 4 }
        val bpp = maxOf(1, channels * depth / 8)
        val stride = (w * channels * depth + 7) / 8
        val px = ByteArray(stride * h)
        var prev = ByteArray(stride)
        for (y in 0 until h) {
            val f = raw[y * (stride + 1)].toInt()
            val line = raw.copyOfRange(y * (stride + 1) + 1, (y + 1) * (stride + 1))
            for (i in 0 until stride) {
                val a = if (i >= bpp) line[i - bpp].toInt() and 0xFF else 0
                val up = prev[i].toInt() and 0xFF
                val c = if (i >= bpp) prev[i - bpp].toInt() and 0xFF else 0
                val v = line[i].toInt() and 0xFF
                line[i] = when (f) {
                    1 -> v + a; 2 -> v + up; 3 -> v + (a + up) / 2
                    4 -> { val p = a + up - c; val pa = kotlin.math.abs(p - a); val pb = kotlin.math.abs(p - up); val pc = kotlin.math.abs(p - c)
                        v + if (pa <= pb && pa <= pc) a else if (pb <= pc) up else c }
                    else -> v
                }.toByte()
            }
            line.copyInto(px, y * stride)
            prev = line
        }
        val argb = IntArray(w * h) { i ->
            val x = i % w; val y = i / w
            fun s(k: Int) = px[y * stride + x * channels + k].toInt() and 0xFF
            when (type) {
                3 -> {
                    val bit = x * depth
                    val idx = ((px[y * stride + bit / 8].toInt() and 0xFF) shr (8 - depth - bit % 8)) and ((1 shl depth) - 1)
                    val a = if (idx < trns.size) trns[idx].toInt() and 0xFF else 255
                    (a shl 24) or ((plte[idx * 3].toInt() and 0xFF) shl 16) or ((plte[idx * 3 + 1].toInt() and 0xFF) shl 8) or (plte[idx * 3 + 2].toInt() and 0xFF)
                }
                0 -> (0xFF shl 24) or (s(0) * 0x010101)
                4 -> (s(1) shl 24) or (s(0) * 0x010101)
                2 -> (0xFF shl 24) or (s(0) shl 16) or (s(1) shl 8) or s(2)
                else -> (s(3) shl 24) or (s(0) shl 16) or (s(1) shl 8) or s(2)
            }
        }
        return CreatorLook.Img(w, h, argb)
    }
}
