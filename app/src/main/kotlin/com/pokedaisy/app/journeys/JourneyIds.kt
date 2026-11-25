package com.pokedaisy.app.journeys

import android.content.Context
import com.pokedaisy.app.GameTitles
import com.pokedaisy.app.Prefs
import com.pokedaisy.app.SavesLocation
import java.io.File
import java.security.MessageDigest
import java.util.Locale

object JourneyIds {
    fun idFor(rom: File): String {
        val slug = rom.nameWithoutExtension.lowercase(Locale.ROOT)
            .replace(Regex("[^a-z0-9]+"), "-").trim('-').take(24).trimEnd('-').ifEmpty { "game" }
        val hash = MessageDigest.getInstance("SHA-256").digest(rom.name.toByteArray(Charsets.UTF_8))
            .take(3).joinToString("") { "%02x".format(it.toInt() and 255) }
        return "$slug-$hash"
    }

    fun roms(context: Context): Map<String, File> =
        context.getSharedPreferences("journey-roms", Context.MODE_PRIVATE).all
            .mapNotNull { (id, path) -> (path as? String)?.let { id to File(it) } }.toMap()

    /** Blocking: register the library save and remember its ROM for display titles. */
    fun register(context: Context, prefs: Prefs, rom: File): JourneysBridge.Result {
        val id = idFor(rom)
        // Hashed and named first, so a retail game is never taken for an unknown one (blocking, like the rest).
        GameTitles.identify(context, listOf(rom))
        val result = JourneysBridge.run(context, "journey", "add", id,
            "--save", SavesLocation.saveFor(context, prefs, rom).absolutePath,
            "--title", GameTitles.label(context, prefs, rom),
            // Official only for a known retail dump: a patched, randomized or unknown ROM stays apart, as a hack is,
            // so nothing from it reaches the Vault or another journey.
            "--kind", if (GameTitles.isKnownRetail(context, rom)) "official" else "romhack")
        if (result.ok) context.getSharedPreferences("journey-roms", Context.MODE_PRIVATE)
            .edit().putString(id, rom.absolutePath).apply()
        return result
    }

    /** Blocking: after [rom]'s game closes, register it and record its Pokémon for the Vault. A game with no save fails
     * quietly. */
    fun record(context: Context, prefs: Prefs, rom: File) {
        runCatching { if (register(context, prefs, rom).ok) JourneysBridge.run(context, "snapshot", idFor(rom)) }
    }
}
