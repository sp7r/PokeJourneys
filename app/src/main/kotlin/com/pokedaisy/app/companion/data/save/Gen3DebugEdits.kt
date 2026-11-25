package com.pokedaisy.app.companion.data.save

val Gen3SaveFormat.eventFlagCount: Int get() = (varsOff - flagsOff) * 8

/** An empty PC slot, starting at the box currently open in the editor. */
fun Gen3SaveData.firstEmptySlot(startBox: Int): BoxSlot? =
    (0 until Gen3SaveData.BOXES).asSequence().flatMap { offset ->
        val box = (startBox + offset) % Gen3SaveData.BOXES
        (0 until Gen3SaveData.BOX_SLOTS).asSequence().map { BoxSlot(box, it) }
    }.firstOrNull { mon(it).isEmpty }

/** Places a generated PC record into the working save and records the species in its Pokédex. */
fun Gen3SaveEditor.addDebugPokemon(at: BoxSlot, record: ByteArray) {
    require(record.size == Gen3BoxMon.SIZE && data.mon(at).isEmpty)
    val pokemon = Gen3BoxMon.read(record, 0)
    require(!pokemon.isBadEgg && !pokemon.isEgg && pokemon.species in 1 until SPECIES_EGG)
    putRecord(at, record)
    markCaught(pokemon.species, pokemon.personality)
}
