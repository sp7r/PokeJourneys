package com.pokedaisy.app.journeys

import android.content.Context
import com.pokedaisy.app.companion.data.PlayerLook
import java.io.File
import java.io.RandomAccessFile
import java.util.zip.CRC32

/**
 * The creator's look ([CreatorLook]) on the DS games' hero. Every one keeps its overworld sprites as Nitro textures
 * (a BTX0 in a NARC on the cart): 32x32 frames, 16 colours, one palette a file - the creator art's own size, so
 * nothing is cropped. The hero's walking and running texture is written over in place (the same bytes count, so no
 * table moves) through [pkNdsRomBlocks], onto melonDS's copy of the cart: the file is never written, and the game
 * reads the texture from the cart whenever it builds the map's objects, so a pick shows from the next map load.
 *
 * - Diamond / Pearl and Platinum `/data/mmodel/mmodel.narc` 90 / 91 (`hero` / `heroine`, Platinum's `pl_boy01c` / `pl_girl01c`), HeartGold / SoulSilver `/a/0/8/1` 69 /
 *   70 (`hero`, `heroine`): 32 textures named .1 - .32 (the standing frames share their data), up, down, left, right,
 *   four frames each (stand, step, stand, step), walking then running - the hub's own order.
 * - Black / White `/a/0/4/9` 6 / 9 (`t4x4hero`, 24 of its 32 drawn), Black 2 / White 2 `/a/0/4/8` 209 / 218
 *   (`t4x4x24`): three frames a direction (stand, step, step), walking then running.
 * Bikes, surfing, fishing, field moves and the battle pictures stay the game's own.
 */
object CreatorLookDs {
    /** One of the hero's textures: its NARC members (boy, girl), texture names, the creator sheets it's drawn from in
     * order ([CreatorLook.canvas]'s motions), frames a direction and the first frame's number. Frames past the
     * directions' (the bike's getting on and off) take the standing frame of a direction in turn. */
    private class Sheet(val boy: Int, val girl: Int, val name: (Boolean) -> String, val motions: List<String>, val perDir: Int, val firstIndex: Int)
    private class Game(val archive: String, val sheets: List<Sheet>)

    private val WALK_RUN = listOf("walk", "run")
    private val BIKE = listOf("bike")

    private fun gameFor(code: String): Game? = when (code.take(3)) {
        "CPU" -> Game("/data/mmodel/mmodel.narc", listOf(
            Sheet(90, 91, { if (it) "pl_girl01c" else "pl_boy01c" }, WALK_RUN, 4, 1),
            Sheet(92, 93, { if (it) "pl_cycheroine" else "pl_cyclehero" }, BIKE, 4, 1),
        ))
        "ADA", "APA" -> Game("/data/mmodel/mmodel.narc", listOf(
            Sheet(90, 91, { if (it) "heroine" else "hero" }, WALK_RUN, 4, 1),
            Sheet(92, 93, { if (it) "cycleheroine" else "cyclehero" }, BIKE, 4, 1),
        ))
        "IPK", "IPG" -> Game("/a/0/8/1", listOf(
            Sheet(69, 70, { if (it) "heroine" else "hero" }, WALK_RUN, 4, 1),
            Sheet(71, 72, { if (it) "cycleheroine" else "cyclehero" }, BIKE, 4, 1),
        ))
        "IRB", "IRA" -> Game("/a/0/4/9", listOf(
            Sheet(6, 9, { "t4x4hero" }, WALK_RUN, 3, 1),
            Sheet(7, 10, { "t4x4cycle" }, BIKE, 3, 1),
        ))
        "IRE", "IRD" -> Game("/a/0/4/8", listOf(
            Sheet(209, 218, { "t4x4x24" }, WALK_RUN, 3, 0),
            Sheet(210, 219, { "t4x4x16" }, BIKE, 3, 0),
        ))
        else -> null
    }

    /** The cart's 4-letter game code, or null if [rom] isn't a DS cart PokeJourneys dresses up. */
    fun codeOf(rom: File): String? = runCatching {
        RandomAccessFile(rom, "r").use { f ->
            val b = ByteArray(4); f.seek(0x0C); f.readFully(b)
            String(b, Charsets.US_ASCII).takeIf { gameFor(it) != null }
        }
    }.getOrNull()

    @JvmStatic external fun pkNdsRomBlocks(offs: IntArray?, lens: IntArray?, crcs: IntArray?, data: ByteArray?): Int

    /** [patch]'s blocks onto the running DS cart (null: the game's own back). Emu thread. */
    fun apply(patch: PlayerLook.Patch?) {
        val blocks = patch?.blocks.orEmpty()
        val data = java.io.ByteArrayOutputStream().also { o -> blocks.forEach { o.write(it.data) } }.toByteArray()
        val n = runCatching {
            if (blocks.isEmpty()) pkNdsRomBlocks(null, null, null, null)
            else pkNdsRomBlocks(IntArray(blocks.size) { blocks[it].off }, IntArray(blocks.size) { blocks[it].data.size }, IntArray(blocks.size) { blocks[it].crc }, data)
        }.getOrElse { -2 }
        android.util.Log.i("pokedaisy", "player look (DS): ${if (n < 0) "not put in ($n)" else "$n block(s) in"}")
    }

    /** The patch for the [female] or male hero of the cart [rom] from the creator's saved look; null with none. */
    fun build(context: Context, rom: File, female: Boolean): PlayerLook.Patch? {
        val look = CreatorLook.saved(context.filesDir) ?: return null
        val art = CreatorLook.apkArt(context)
        // The companion's map head and card picture, as for the GBA games.
        CreatorLook.hero(art, look)?.let { CreatorLook.keep(context.filesDir, it) }
        val canvases = HashMap<String, IntArray>()
        val canvas = { motion: String -> canvases.getOrPut(motion) { CreatorLook.canvas(art, look, motion) } }
        if (canvas("walk").none { it ushr 24 != 0 }) return null
        return RandomAccessFile(rom, "r").use { build(it, canvas, female) }
    }

    /** [build] from the creator's 128x128 sheets by motion ([CreatorLook.canvas]: rows down, left, right, up): the walking
     * and running texture, and the bike's where the art has one. Null if the walking one can't be made. */
    fun build(f: RandomAccessFile, canvas: (String) -> IntArray, female: Boolean): PlayerLook.Patch? {
        val code = ByteArray(4).also { f.seek(0x0C); f.readFully(it) }.toString(Charsets.US_ASCII)
        val game = gameFor(code) ?: return null
        val (start, narcBytes) = file(f, game.archive) ?: return null
        val narc = Narc(narcBytes)
        val blocks = ArrayList<PlayerLook.Block>()
        for ((i, sheet) in game.sheets.withIndex()) {
            val canvases = sheet.motions.map(canvas)
            if (canvases.any { c -> c.none { it ushr 24 != 0 } }) { if (i == 0) return null else continue }
            blocks += sheet(narc, start, sheet, canvases, female) ?: if (i == 0) return null else continue
        }
        return PlayerLook.Patch(blocks, emptyList())
    }

    /** One texture's blocks: [sheet]'s frames drawn from [canvases] in a palette of their own. */
    private fun sheet(narc: Narc, start: Int, sheet: Sheet, canvases: List<IntArray>, female: Boolean): List<PlayerLook.Block>? {
        val game = sheet
        val member = if (female) game.girl else game.boy
        val (mOff, m) = narc.member(member) ?: return null
        if (String(m, 0, 4, Charsets.US_ASCII) != "BTX0") return null
        val tex0 = u32(m, 0x10)
        val texDict = tex0 + u16(m, tex0 + 0x0E)
        val texData = tex0 + u32(m, tex0 + 0x14)
        val count = m[texDict + 1].toInt() and 0xFF
        val params = texDict + 16 + count * 4
        val names = params + count * 8
        val palDict = tex0 + u32(m, tex0 + 0x34)
        val palData = tex0 + u32(m, tex0 + 0x38)
        val palAt = palData + (u16(m, palDict + 16 + (m[palDict + 1].toInt() and 0xFF) * 4) shl 3)
        val wanted = game.name(female)
        val perMotion = 4 * game.perDir
        // The creator art's rows for the game's direction order (up, down, left, right); its columns for the game's frames.
        val rows = intArrayOf(3, 0, 1, 2)
        val cols = if (game.perDir == 4) intArrayOf(0, 1, 2, 3) else intArrayOf(0, 1, 3)
        val frames = HashMap<Int, IntArray>()   // texel offset -> 32x32 ARGB
        for (k in 0 until count) {
            val name = String(m, names + k * 16, 16, Charsets.US_ASCII).substringBefore('\u0000')
            if (name.substringBeforeLast('.') != wanted) return null
            val w = u32(m, params + k * 8)
            if ((w shr 20) and 7 != 2 || (w shr 23) and 7 != 2 || (w shr 26) and 7 != 3) return null   // 32x32, 16 colours
            val frame = (name.substringAfterLast('.').toIntOrNull() ?: return null) - game.firstIndex
            if (frame < 0) continue
            val total = canvases.size * perMotion
            // Past the directions: a bike's getting on and off (each direction's standing frame in turn); a walking
            // texture's are blank (Black / White's last eight), left as they are.
            if (frame >= total && game.motions != BIKE) continue
            val motion = if (frame >= total) canvases.size - 1 else frame / perMotion
            val row = rows[if (frame >= total) (frame - total) % 4 else (frame % perMotion) / game.perDir]
            val col = if (frame >= total) 0 else cols[frame % game.perDir]
            val c = canvases[motion]
            frames[(w and 0xFFFF) shl 3] = IntArray(32 * 32) { i -> c[(row * 32 + i / 32) * 128 + col * 32 + i % 32] }
        }
        if (frames.isEmpty()) return null
        // 15 colours (0 is see-through): the look's, the closest merged (weighted by use) until they fit.
        val counts = HashMap<Int, Int>()
        frames.values.forEach { fr -> fr.forEach { if (it ushr 24 >= 128) counts.merge(bgr(it), 1, Int::plus) } }
        val groups = counts.map { (c, n) -> mutableListOf(c) to n }.toMutableList()
        fun centre(g: List<Int>) = g.maxBy { counts[it] ?: 0 }
        while (groups.size > 15) {
            var best = Triple(0, 1, Int.MAX_VALUE)
            for (i in groups.indices) for (j in i + 1 until groups.size) {
                val d = dist(centre(groups[i].first), centre(groups[j].first)) * minOf(groups[i].second, groups[j].second)
                if (d < best.third) best = Triple(i, j, d)
            }
            groups[best.first] = (groups[best.first].first + groups[best.second].first).toMutableList() to groups[best.first].second + groups[best.second].second
            groups.removeAt(best.second)
        }
        val pal = m.copyOfRange(palAt, palAt + 32)
        val index = HashMap<Int, Int>()
        groups.sortedByDescending { it.second }.forEachIndexed { i, (g, _) ->
            val c = centre(g)
            pal[(i + 1) * 2] = c.toByte(); pal[(i + 1) * 2 + 1] = (c shr 8).toByte()
            g.forEach { index[it] = i + 1 }
        }
        val writes = ArrayList<Pair<Int, ByteArray>>()
        for ((off, fr) in frames) {
            val texels = ByteArray(512)
            for (i in 0 until 1024) {
                val c = fr[i]
                val v = if (c ushr 24 >= 128) index[bgr(c)] ?: 0 else 0
                texels[i / 2] = (texels[i / 2].toInt() or (v shl if (i and 1 != 0) 4 else 0)).toByte()
            }
            writes += (texData + off) to texels
        }
        writes += palAt to pal
        // Into the cart's offsets, each block with the CRC32 of the file's bytes under it.
        val base = start + mOff
        return writes.sortedBy { it.first }.map { (at, bytes) ->
            val orig = m.copyOfRange(at, at + bytes.size)
            PlayerLook.Block(base + at, CRC32().apply { update(orig) }.value.toInt(), bytes)
        }
    }

    private fun bgr(argb: Int) = ((argb shr 19) and 31) or (((argb shr 11) and 31) shl 5) or (((argb shr 3) and 31) shl 10)
    private fun dist(a: Int, b: Int) = CreatorLook.dist(a, b)
    private fun u16(b: ByteArray, o: Int) = (b[o].toInt() and 0xFF) or ((b[o + 1].toInt() and 0xFF) shl 8)
    private fun u32(b: ByteArray, o: Int) = u16(b, o) or (u16(b, o + 2) shl 16)

    /** The cart file at [path] (header FNT / FAT): where it starts on the cart, and its bytes. */
    private fun file(f: RandomAccessFile, path: String): Pair<Int, ByteArray>? {
        val header = ByteArray(0x50).also { f.seek(0); f.readFully(it) }
        val fntOff = u32(header, 0x40); val fntLen = u32(header, 0x44); val fatOff = u32(header, 0x48)
        val fnt = ByteArray(fntLen).also { f.seek(fntOff.toLong()); f.readFully(it) }
        var dir = 0
        val parts = path.trim('/').split('/')
        for ((i, part) in parts.withIndex()) {
            var p = u32(fnt, dir * 8)
            var id = u16(fnt, dir * 8 + 4)
            var found: Int? = null
            while (true) {
                val t = fnt[p++].toInt() and 0xFF
                if (t == 0) break
                val name = String(fnt, p, t and 0x7F, Charsets.ISO_8859_1); p += t and 0x7F
                if (t and 0x80 != 0) {
                    val sub = u16(fnt, p) and 0xFFF; p += 2
                    if (name == part && i < parts.size - 1) { found = sub; break }
                } else {
                    if (name == part && i == parts.size - 1) {
                        val e = ByteArray(8).also { f.seek(fatOff.toLong() + id * 8); f.readFully(it) }
                        val s = u32(e, 0); val end = u32(e, 4)
                        return s to ByteArray(end - s).also { f.seek(s.toLong()); f.readFully(it) }
                    }
                    id++
                }
            }
            dir = found ?: return null
        }
        return null
    }

    private class Narc(val d: ByteArray) {
        private val count: Int
        private val fat: Int
        private val base: Int
        init {
            require(String(d, 0, 4, Charsets.US_ASCII) == "NARC")
            var o = u16(d, 0x0C)
            fat = o + 12
            count = u16(d, o + 8)
            o += u32(d, o + 4)
            o += u32(d, o + 4)
            base = o + 8
        }
        /** Member [i]: its offset in the NARC, and its bytes. */
        fun member(i: Int): Pair<Int, ByteArray>? {
            if (i !in 0 until count) return null
            val s = base + u32(d, fat + i * 8)
            val e = base + u32(d, fat + i * 8 + 4)
            return s to d.copyOfRange(s, e)
        }
    }
}
