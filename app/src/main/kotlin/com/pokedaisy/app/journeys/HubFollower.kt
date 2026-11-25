package com.pokedaisy.app.journeys

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.AtomicFile
import com.pokedaisy.app.RomArchive
import com.pokedaisy.app.RomIdentity
import com.pokedaisy.app.companion.data.MonArt
import com.pokedaisy.app.companion.data.NdsArt
import com.pokedaisy.app.companion.data.RomArt
import com.pokedaisy.app.companion.data.save.RomMonIcons
import com.pokedaisy.app.companion.i18n.tr
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import okio.Path.Companion.toOkioPath

/** The hub's follower is a Vault entry. Sending it out doesn't move or modify the Pokémon. */
internal object HubFollower {
    data class Identity(val id: String, val account: String)
    class Asset(val sheet: ByteArray = ByteArray(0), val message: String = "", val identity: Identity? = null)

    private const val FRAME = 32
    private const val FRAME_COUNT = 16
    private val islandSprites = mapOf(25 to "pikachu_1", 39 to "purin_1", 54 to "koduck_1", 79 to "yadon_1")
    private val iconDirs = listOf(NdsArt.HEARTGOLD_ICONS, NdsArt.PLATINUM_ICONS, NdsArt.BLACK2_ICONS, NdsArt.BLACK_ICONS)

    private fun selection(context: Context, account: String = DiscordSignIn.accountId(context.filesDir)): AtomicFile =
        AtomicFile(File(context.filesDir, "accounts/$account/hub-follower"))

    fun selectedId(context: Context, account: String = DiscordSignIn.accountId(context.filesDir)): String? = runCatching {
        selection(context, account).readFully().decodeToString().takeIf { it.isNotBlank() }
    }.getOrNull()

    fun select(context: Context, id: String) {
        val selection = selection(context)
        val stream = selection.startWrite()
        try {
            stream.write(id.encodeToByteArray())
            selection.finishWrite(stream)
        } catch (error: Exception) {
            selection.failWrite(stream)
            throw error
        }
    }

    fun entry(context: Context, id: String): JSONObject? {
        val index = File(JourneysBridge.dataDir(context), "vault/index.json")
        val entries = if (index.isFile) JSONArray(index.readText()) else JSONArray()
        return (0 until entries.length()).asSequence().mapNotNull { entries.optJSONObject(it) }
            .firstOrNull { it.optString("id") == id }
    }

    /** Blocking. Checks the live Vault index before sending out a follower. */
    fun load(context: Context): Asset {
        val account = DiscordSignIn.accountId(context.filesDir)
        val id = selectedId(context, account) ?: return Asset(message = tr("Choose a Pokémon with FOLLOW IN HUB in the Vault."))
        val entry = entry(context, id)
            ?: return Asset(message = tr("Your follower is no longer in the Vault. Choose another Pokémon there."))
        val identity = Identity(id, account)
        runCatching { FollowerPackArt.load(context, id) }.getOrNull()?.let { return Asset(it, identity = identity) }
        val species = entry.getInt("species")
        val islandSheet = islandSprites[species]?.let { File(HubActivity.dataDir(context), "sprites/$it.png") }
        if (islandSheet?.isFile == true) return Asset(islandSheet.readBytes(), identity = identity)
        MonArt.load(context.filesDir, species)?.let { return Asset(overworldSheet(it), identity = identity) }

        val icon = iconDirs.firstNotNullOfOrNull { dir ->
            val file = File(RomArt.dir(context.filesDir), "$dir/$species.png")
            if (file.isFile) BitmapFactory.decodeFile(file.path) else null
        } ?: gbaIcon(context, entry.optString("fromGame"), species)
        return if (icon != null) Asset(iconSheet(icon), identity = identity)
        else Asset(message = tr("No sprite for this Pokémon is available from your journeys yet."))
    }

    /**
     * Another player's follower in the hub, by National Pokédex number: from the follower pack when it's in the hub
     * data, else drawn from this player's own journeys (the island's Pokémon, then the DS overworld art, then a DS icon). Empty when none of them has it.
     */
    fun sheetFor(context: Context, species: Int, shiny: Boolean = false): ByteArray {
        runCatching { FollowerPackArt.forSpecies(context, species, shiny) }.getOrNull()?.let { return it }
        val islandSheet = islandSprites[species]?.let { File(HubActivity.dataDir(context), "sprites/$it.png") }
        if (islandSheet?.isFile == true) return islandSheet.readBytes()
        MonArt.load(context.filesDir, species)?.let { return overworldSheet(it) }
        val icon = iconDirs.firstNotNullOfOrNull { dir ->
            val file = File(RomArt.dir(context.filesDir), "$dir/$species.png")
            if (file.isFile) BitmapFactory.decodeFile(file.path) else null
        } ?: return ByteArray(0)
        return iconSheet(icon)
    }

    private fun gbaIcon(context: Context, journey: String, national: Int): Bitmap? {
        // The GBA icon tables use National Pokédex IDs through Celebi.
        if (national !in 1..251) return null
        val rom = JourneyIds.roms(context)[journey]?.takeIf { it.isFile } ?: return null
        val tables = RomMonIcons.tablesFor(RomIdentity.sha1(rom), RomIdentity.gameCode(rom), RomIdentity.revision(rom)) ?: return null
        val playable = RomArchive.playable(rom, context.cacheDir) ?: return null
        // PokeDaisy 1.6.2 reads the icons as pixels (shared with its iPad app).
        return RomMonIcons.open(playable.toOkioPath(), tables)?.get(national)
            ?.let { Bitmap.createBitmap(it.argb, it.width, it.height, Bitmap.Config.ARGB_8888) }
    }

    private fun overworldSheet(mon: MonArt.Mon): ByteArray {
        val palette = RomArt.palette(mon.owPal)
        val frameBytes = FRAME * FRAME / 2
        val frames = List(6) { index ->
            RomArt.sprite(mon.frames.copyOfRange(index * frameBytes, (index + 1) * frameBytes), palette, FRAME, FRAME).argb
        }
        // MonArt is south, north, west. The hub uses north, south, west, east.
        val direction = intArrayOf(2, 0, 4, 4)
        return sheet { index -> frames[direction[index / 4] + index % 2] }
    }

    private fun iconSheet(icon: Bitmap): ByteArray {
        val size = minOf(icon.width, icon.height, FRAME)
        val frames = List(2) { index ->
            IntArray(size * size).also { pixels ->
                icon.getPixels(pixels, 0, size, (icon.width - size) / 2, minOf(size * index, icon.height - size), size, size)
            }
        }
        val feet = frames.maxOf { pixels -> pixels.indexOfLast { it ushr 24 != 0 } / size }
        val placed = frames.map { pixels ->
            val result = IntArray(FRAME * FRAME)
            val x = (FRAME - size) / 2
            val y = (FRAME - 2 - feet).coerceAtLeast(0)
            for (row in 0 until minOf(size, FRAME - y)) {
                pixels.copyInto(result, (y + row) * FRAME + x, row * size, (row + 1) * size)
            }
            result
        }
        return sheet { index -> placed[index % 2] }
    }

    private fun sheet(frame: (Int) -> IntArray): ByteArray {
        val width = FRAME * FRAME_COUNT
        val image = RomArt.Image(width, FRAME)
        repeat(FRAME_COUNT) { index ->
            val pixels = frame(index)
            for (y in 0 until FRAME) for (x in 0 until FRAME) {
                val sourceX = if (index >= 12) FRAME - 1 - x else x
                image.argb[y * width + index * FRAME + x] = pixels[y * FRAME + sourceX]
            }
        }
        return image.png()
    }
}
