package com.pokedaisy.app.journeys

import android.content.Context
import com.pokedaisy.app.GameTitles
import com.pokedaisy.app.Prefs
import com.pokedaisy.app.companion.data.RomCategory
import com.pokedaisy.app.RomCrcs
import com.pokedaisy.app.RomIdentity
import com.pokedaisy.app.SaveStates
import com.pokedaisy.app.SavesLocation
import java.io.File

/** Select the hub trainer before launching a brand-new retail journey. */
internal object JourneyStart {
    const val EXTRA_IDENTITY = "journeyStartIdentity"

    fun prepare(context: Context, prefs: Prefs, rom: File): String? {
        val crc = RomCrcs.cached(context, rom) ?: return null
        val key = "%08x".format(crc)
        if (SavesLocation.saveFor(context, prefs, rom).exists()) return null
        val states = SaveStates(context.getExternalFilesDir(null) ?: context.filesDir, key)
        if (states.resumeFile.exists()) return null
        val look = CreatorLook.saved(context.filesDir) ?: return null
        if (look.optString("name").isBlank()) return null
        GameTitles.identify(context, listOf(rom))
        if (!GameTitles.isKnownRetail(context, rom) && !GameTitles.isKnownDsVariant(context, rom)) return null
        val platform = GameTitles.platform(context, rom)
        if (platform !in listOf(RomCategory.GB, RomCategory.GBC, RomCategory.GBA, RomCategory.NDS)) return null
        val identity = RomIdentity.sha1(rom) ?: return null
        prefs.setPlayerLookFor(key, CreatorLook.PICK)
        return identity
    }
}
