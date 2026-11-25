package com.pokedaisy.app.journeys

import com.pokedaisy.app.companion.data.CardStyle
import com.pokedaisy.app.companion.data.LookArt
import com.pokedaisy.app.companion.data.MonArt
import com.pokedaisy.app.companion.data.RomArt
import com.pokedaisy.app.companion.data.TrainerCardArt
import okio.Path.Companion.toOkioPath
import java.io.File

// PokeDaisy 1.6.2's art code takes okio paths (it's shared with its iPad app); the journeys keep java.io.File.

internal fun RomArt.dir(filesDir: File): File = dir(filesDir.toOkioPath()).toFile()
internal fun RomArt.prefetch(filesDir: File, romKey: String, rom: File) = prefetch(filesDir.toOkioPath(), romKey, rom.toOkioPath())
internal fun LookArt.dir(filesDir: File): File = dir(filesDir.toOkioPath()).toFile()
internal fun MonArt.load(filesDir: File, national: Int): MonArt.Mon? = load(filesDir.toOkioPath(), national)
internal fun TrainerCardArt.load(dir: File, style: CardStyle): TrainerCardArt.Art? = load(dir.toOkioPath(), style)
