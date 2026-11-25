package com.pokedaisy.app.journeys

import android.content.Context
import android.util.AtomicFile
import com.pokedaisy.app.RomCategory
import com.pokedaisy.app.RomIdentity
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * What the island's trainer card says about the signed-in account's play: the time spent in journeys and the last one
 * played. Kept in the account's own folder (`files/accounts/<id>/stats.json`), written by the main process when a
 * game closes ([JourneyLaunchActivity]) and read by the hub's ([HubCompanion]).
 */
object TrainerStats {

    class Stats(val seconds: Long, val lastJourney: String, val regions: Set<Region>)

    private fun file(context: Context) =
        AtomicFile(File(context.filesDir, "accounts/${DiscordSignIn.accountId(context.filesDir)}/stats.json"))

    fun read(context: Context): Stats {
        return read(file(context))
    }

    private fun read(file: AtomicFile): Stats {
        val json = runCatching { JSONObject(file.readFully().decodeToString()) }.getOrNull() ?: JSONObject()
        val title = json.optString("lastJourney")
        val stored = json.optJSONArray("regions")
        val regions = if (stored == null) setOfNotNull(Region.fromLegacyTitle(title)) else
            (0 until stored.length()).mapNotNull { i -> Region.entries.firstOrNull { it.name == stored.optString(i) } }.toSet()
        return Stats(json.optLong("seconds"), title, regions)
    }

    /** Adds the play session and records its region once per trainer. */
    @Synchronized
    fun played(context: Context, seconds: Long, journey: String, region: Region?) {
        runCatching {
            val file = file(context)
            val before = read(file)
            val regions = before.regions + listOfNotNull(region)
            val stats = JSONObject().put("seconds", before.seconds + seconds.coerceAtLeast(0)).put("lastJourney", journey)
                .put("regions", JSONArray(regions.map { it.name }.sorted()))
            val stream = file.startWrite()
            try {
                stream.write(stats.toString().encodeToByteArray())
                file.finishWrite(stream)
            } catch (error: Exception) {
                file.failWrite(stream)
                throw error
            }
        }
    }

    enum class Region {
        KANTO, JOHTO, HOENN, SINNOH, UNOVA;

        companion object {
            fun of(rom: File, platform: RomCategory?): Region? = when (platform) {
                RomCategory.GB -> KANTO
                RomCategory.GBC -> JOHTO
                RomCategory.GBA -> when (RomIdentity.gameCode(rom)?.take(3)) {
                    "BPR", "BPG" -> KANTO
                    "AXV", "AXP", "BPE" -> HOENN
                    else -> null
                }
                RomCategory.NDS -> when (RomIdentity.ndsGameCode(rom)?.take(3)) {
                    "ADA", "APA", "CPU" -> SINNOH
                    "IPK", "IPG" -> JOHTO
                    "IRB", "IRA", "IRE", "IRD" -> UNOVA
                    else -> null
                }
                else -> null
            }

            /** Older accounts recorded the last journey's title but had no region list. */
            internal fun fromLegacyTitle(title: String): Region? =
                when (title.removeSuffix(JourneyDsCatalog.VARIANT_SUFFIX).removePrefix("Pokémon ").lowercase()) {
                    "red", "blue", "yellow", "firered", "leafgreen" -> KANTO
                    "gold", "silver", "crystal", "heartgold", "soulsilver" -> JOHTO
                    "ruby", "sapphire", "emerald" -> HOENN
                    "diamond", "pearl", "platinum" -> SINNOH
                    "black", "white", "black 2", "white 2" -> UNOVA
                    else -> null
                }
        }
    }
}
