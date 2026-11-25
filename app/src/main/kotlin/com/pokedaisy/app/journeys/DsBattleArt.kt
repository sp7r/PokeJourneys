package com.pokedaisy.app.journeys

import android.content.Context
import com.pokedaisy.app.Prefs
import com.pokedaisy.app.RomFolder
import com.pokedaisy.app.companion.data.DsPorts
import com.pokedaisy.app.companion.data.GameKind
import com.pokedaisy.app.companion.data.Gen5Lz
import com.pokedaisy.app.companion.data.NdsArt
import com.pokedaisy.app.companion.data.NdsArt.u8
import com.pokedaisy.app.companion.data.NdsArt.u16
import com.pokedaisy.app.companion.data.NdsArt.u32
import com.pokedaisy.app.companion.data.OriginHeartGold
import com.pokedaisy.app.companion.data.RenegadePlatinum
import com.pokedaisy.app.companion.data.RomArt
import java.io.File
import java.io.RandomAccessFile

internal class DsBattleArt(private val filesDir: File, private val roms: () -> List<File>) {
    constructor(context: Context) : this(context.filesDir, { RomFolder.libraryRoms(context, Prefs(context)) })

    private enum class Game(val folder: String, val lastSpecies: Int, val archive: String = "/a/0/0/4") {
        HEARTGOLD("heartgold", 493),
        SOULSILVER("soulsilver", 493),
        PLATINUM("platinum", 493, "/poketool/pokegra/pl_pokegra.narc"),
        BLACK2("black2", 649),
        WHITE2("white2", 649),
        BLACK("black", 649),
        WHITE("white", 649),
    }

    private data class Source(val rom: File, val game: Game, val stamp: String)

    private val sources by lazy {
        runCatching { roms().mapNotNull(::source).sortedBy { it.game.ordinal } }.getOrDefault(emptyList())
    }

    @Synchronized
    fun picture(species: Int, back: Boolean, shiny: Boolean): ByteArray? {
        if (species !in 1..649) return null
        for (source in sources) {
            if (species > source.game.lastSpecies) continue
            runCatching { picture(source, species, back, shiny) }.getOrNull()?.let { return it }
        }
        return null
    }

    private fun picture(source: Source, species: Int, back: Boolean, shiny: Boolean): ByteArray? {
        val view = (if (back) "back" else "front") + if (shiny) "-shiny" else ""
        val path = "nds/${source.game.folder}/battle/${source.stamp}/$view/$species.png"
        val root = RomArt.dir(filesDir)
        runCatching { File(root, path).takeIf { it.isFile }?.readBytes() }.getOrNull()?.let { return it }
        val image = RandomAccessFile(source.rom, "r").use { f ->
            val header = f.read(0, 0x200)
            val range = fileRange(f, header, source.game.archive) ?: return null
            val narc = CartNarc(f, range)
            if (source.game.lastSpecies == 493) gen4(narc, species, back, shiny) else gen5(narc, species, back, shiny)
        } ?: return null
        val png = image.png()
        runCatching { File(root, path).apply { parentFile?.mkdirs() }.let { out -> File(out.path + ".tmp").apply { writeBytes(png) }.renameTo(out) } }
        return png
    }

    private fun source(rom: File): Source? = runCatching {
        if (!rom.extension.equals("nds", ignoreCase = true)) return null
        RandomAccessFile(rom, "r").use { f ->
            val header = f.read(0, 0x200)
            val code = String(header, 0x0C, 4, Charsets.US_ASCII)
            val revision = u8(header, 0x1E)
            val game = game(code, revision) ?: return null
            if (OriginHeartGold.matches { off, len -> f.read(off, len) }) return null
            if (RenegadePlatinum.matches { off, len -> f.read(off, len) }) return null
            Source(rom, game, "$code-$revision-${rom.length()}-${rom.lastModified()}")
        }
    }.getOrNull()

    private fun game(code: String, revision: Int): Game? {
        if (NdsArt.isHgss(code, revision)) return if (code.startsWith("IPG")) Game.SOULSILVER else Game.HEARTGOLD
        if (NdsArt.isPlatinum(code, revision)) return Game.PLATINUM
        val port = DsPorts.of(code, revision)?.kind
        return when {
            code == "IREO" && revision == 0 || port == GameKind.BLACK2 -> Game.BLACK2
            code == "IRDO" && revision == 0 || port == GameKind.WHITE2 -> Game.WHITE2
            code in setOf("IRBO", "IRBF") && revision == 0 || port == GameKind.BLACK -> Game.BLACK
            code in setOf("IRAO", "IRAF") && revision == 0 || port == GameKind.WHITE -> Game.WHITE
            else -> null
        }
    }

    private fun gen4(narc: CartNarc, species: Int, back: Boolean, shiny: Boolean): RomArt.Image? {
        val base = species * 6
        val palette = NdsArt.palettes(narc.member(base + if (shiny) 5 else 4)).firstOrNull() ?: return null
        val male = if (back) 1 else 3
        val chars = listOf(male, male - 1).firstNotNullOfOrNull { offset ->
            NdsArt.ncgrData(narc.member(base + offset))?.takeIf { it.size >= 6400 }
        } ?: return null
        val pixels = NdsArt.unscanPokepic(chars)
        val image = RomArt.Image(80, 80)
        for (y in 0 until 80) {
            for (x in 0 until 80) {
                val packed = u8(pixels, y * 80 + x / 2)
                val colour = if (x and 1 == 1) packed shr 4 else packed and 15
                if (colour != 0) image.argb[y * 80 + x] = palette[colour]
            }
        }
        return image
    }

    private fun gen5(narc: CartNarc, species: Int, back: Boolean, shiny: Boolean): RomArt.Image? {
        val base = species * 20
        val palette = NdsArt.palettes(narc.member(base + if (shiny) 19 else 18)).firstOrNull() ?: return null
        // The first-frame NCGR pair starts at 0 for fronts and 9 for backs; the second is the female picture.
        val first = if (back) 9 else 0
        val chars = (first..first + 1).firstNotNullOfOrNull { offset ->
            narc.member(base + offset)?.let(Gen5Lz::decompress)?.let(NdsArt::ncgrData)?.takeIf { it.size >= 4608 }
        } ?: return null
        val image = RomArt.Image(96, 96)
        var tile = 0
        for ((bx, by, width, height) in NdsArt.BLACK_FRONT_BLOCKS) {
            for (t in 0 until width * height / 64) {
                for (y in 0 until 8) {
                    for (x in 0 until 8) {
                        val colour = NdsArt.tilePixel(chars, tile + t, x, y)
                        val at = (by + t / (width / 8) * 8 + y) * 96 + bx + t % (width / 8) * 8 + x
                        if (colour != 0) image.argb[at] = palette[colour]
                    }
                }
            }
            tile += width * height / 64
        }
        return image
    }

    private data class Range(val start: Long, val end: Long)

    /** NdsArt's FNT walk, returning a range so the picture archive stays on the cartridge. */
    private fun fileRange(f: RandomAccessFile, header: ByteArray, path: String): Range? {
        val size = u32(header, 0x44).takeIf { it in 1..(1L shl 20) } ?: return null
        val fnt = f.read(u32(header, 0x40), size.toInt())
        var id = 0xF000
        val parts = path.trim('/').split('/')
        for ((index, name) in parts.withIndex()) {
            val entry = (id and 0xFFF) * 8
            var p = u32(fnt, entry).toInt()
            var fileId = u16(fnt, entry + 4)
            var found = -1
            while (true) {
                val length = u8(fnt, p++)
                if (length == 0) break
                val directory = length and 0x80 != 0
                val count = length and 0x7F
                val entryName = String(fnt, p, count, Charsets.US_ASCII)
                p += count
                val next = if (directory) u16(fnt, p) else fileId++
                if (directory) p += 2
                if (entryName == name && directory == (index < parts.lastIndex)) {
                    found = next
                    break
                }
            }
            if (found < 0) return null
            id = found
        }
        val fat = f.read(u32(header, 0x48) + id * 8L, 8)
        val range = Range(u32(fat, 0), u32(fat, 4))
        return range.takeIf { it.start < it.end && it.end <= f.length() }
    }

    /** Only the NARC index goes through NdsArt's parser; each member is read directly from the ROM. */
    private class CartNarc(private val f: RandomAccessFile, private val range: Range) {
        private val index: NdsArt.Narc

        init {
            val header = read(0, 16)
            var offset = u16(header, 0x0C).toLong()
            repeat(2) {
                val block = read(offset, 8)
                val size = u32(block, 4)
                require(size >= 8)
                offset += size
            }
            require(offset + 8 <= 1L shl 20)
            index = NdsArt.Narc(read(0, (offset + 8).toInt()))
        }

        fun member(id: Int): ByteArray? {
            if (id !in 0 until index.size) return null
            val offset = index.fat + id * 8
            val start = u32(index.d, offset)
            val end = u32(index.d, offset + 4)
            if (end <= start || end - start > 1L shl 20) return null
            return read(index.base + start, (end - start).toInt())
        }

        private fun read(offset: Long, size: Int): ByteArray {
            require(offset >= 0 && size >= 0 && offset + size <= range.end - range.start)
            return f.read(range.start + offset, size)
        }
    }
}

private fun RandomAccessFile.read(off: Long, len: Int): ByteArray = ByteArray(len).also { seek(off); readFully(it) }
