package com.pokedaisy.app.journeys

import com.pokedaisy.app.RomIdentity
import java.io.File

/** Recognized DS journeys that need separate cartridge identity and companion support checks. */
internal object JourneyDsCatalog {
    val retail = mapOf(
        "a46233d8b79a69ea87aa295a0efad5237d02841e" to "Pokémon Diamond", // US Rev 5
        "99083bf15ec7c6b81b4ba241ee10abd9e80999ac" to "Pokémon Pearl", // US Rev 5
        "ce81046eda7d232513069519cb2085349896dec7" to "Pokémon Platinum", // US Rev 0
    )

    const val VARIANT_SUFFIX = " (ROM variant)"
    val variants = mapOf(
        "c5072bf51a5ecc51ade99d3506c023f5bac3eeb3" to "Pokémon Platinum$VARIANT_SUFFIX",
        "30793e274fb4c7ba070ae226edbdfe355504b1f5" to "Pokémon HeartGold$VARIANT_SUFFIX",
        "a68b3bedf5c1e53556e41e59cdf396c20b331896" to "Pokémon Black$VARIANT_SUFFIX",
        "42f7a3daf0601064c9067a6a2903a83ec081442b" to "Pokémon Black 2$VARIANT_SUFFIX",
    )

    // These are the games whose known releases can be listed without a companion memory reader.
    val playbackCodes = setOf("ADAE", "APAE", "CPUE")

    fun canPlayWithoutCompanion(rom: File): Boolean =
        RomIdentity.isNds(rom) && RomIdentity.ndsGameCode(rom) in playbackCodes &&
            RomIdentity.sha1(rom).let { it in retail || it in variants }
}
