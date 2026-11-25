package com.pokedaisy.app.journeys

import android.content.Context
import android.util.Base64
import com.pokedaisy.app.companion.i18n.tr
import java.io.File

/** Returns a PK3 PC record over stdout. The bridge only reads the source save. */
internal fun generateDebugPokemon(context: Context, save: File, gameCode: String, species: Int, level: Int): ByteArray {
    val result = JourneysBridge.run(context, "debug-pokemon", save.absolutePath, gameCode, species.toString(), level.toString())
    check(result.ok) { result.error.ifEmpty { tr("Couldn't create that Pokémon.") } }
    return Base64.decode(result.output, Base64.DEFAULT)
}
