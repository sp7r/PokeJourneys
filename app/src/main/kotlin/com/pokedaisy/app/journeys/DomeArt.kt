package com.pokedaisy.app.journeys

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import com.pokedaisy.app.companion.data.MonArt
import com.pokedaisy.app.companion.data.NdsArt
import com.pokedaisy.app.companion.data.RomArt
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/** Battle pictures and fallback follower frames from the player's own local art; nothing is downloaded. */
internal class DomeArt(private val context: Context) {
    private val cache = ConcurrentHashMap<String, ByteArray>()
    private val dsArt = DsBattleArt(context)

    fun picture(species: Int, back: Boolean, shiny: Boolean, sprite: String): ByteArray? {
        if (species !in 1..807) return null
        val key = "$species/$back/$shiny/$sprite"
        cache[key]?.let { return it }
        if (!shiny) MonArt.load(context.filesDir, species)?.let { mon ->
            val image = RomArt.sprite(if (back) mon.back else mon.front, RomArt.palette(mon.pal), 64, 64).png()
            cache[key] = image
            return image
        }
        dsArt.picture(species, back, shiny)?.let { image ->
            cache[key] = image
            return image
        }
        if (sprite.matches(Regex("[A-Za-z0-9]+"))) {
            val root = File(HubActivity.dataDir(context), "followers")
            val folders = if (shiny) listOf("Followers shiny", "Followers") else listOf("Followers")
            for (folder in folders) {
                val file = File(root, "$folder/$sprite.png")
                val sheet = if (file.isFile) BitmapFactory.decodeFile(file.path) else null
                if (sheet != null) {
                    try {
                        val cell = sheet.width / 4
                        val row = if (back) 3 else 0
                        val frame = Bitmap.createBitmap(sheet, 0, row * cell, cell, cell)
                        val bytes = ByteArrayOutputStream().also { frame.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
                        if (frame !== sheet) frame.recycle()
                        cache[key] = bytes
                        return bytes
                    } finally { sheet.recycle() }
                }
            }
        }
        for (dir in listOf(NdsArt.BLACK2_ICONS, NdsArt.BLACK_ICONS, NdsArt.HEARTGOLD_ICONS, NdsArt.PLATINUM_ICONS)) {
            val file = File(RomArt.dir(context.filesDir), "$dir/$species.png")
            if (file.isFile) return file.readBytes().also { cache[key] = it }
        }
        return null
    }
}
