package com.pokedaisy.app.companion

import androidx.compose.runtime.mutableStateOf
import com.pokedaisy.app.companion.data.RomArt

/**
 * PokeJourneys: what the companion's screens (shared with PokeDaisy's iPad build, so without the app's Android code)
 * need from the journeys. The app fills in the functions at start (PokeDaisyApp); journeys/CreatorLook.kt keeps the rest.
 */
object JourneyHooks {
    /** The running game wears the creator's look now: the MAP head, the CARD picture and PLAYER LOOK follow it. */
    val creatorWorn = mutableStateOf(false)

    /** PLAYER LOOK's entry for the creator's look, and its saved source name. */
    const val CREATOR_PICK = "CREATOR"
    const val CREATOR_SOURCE = "CREATOR"

    /** The region map's head for the creator's look (RomArt's `regionmap/` like a hero's). */
    const val CREATOR_HEAD = "player_creator"

    /** The creator's look's CARD front picture, or null. Blocking. */
    @Volatile var creatorFrontPic: () -> Pair<ByteArray, ByteArray>? = { null }

    /** The PLAYER LOOK picker's tile for the creator's look, or null. Blocking. */
    @Volatile var creatorWalk: () -> List<RomArt.Image>? = { null }
}
