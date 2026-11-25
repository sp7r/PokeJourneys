package com.pokedaisy.app.journeys

import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/**
 * Builds the hub's rooms on a PC from real cartridges, to compare with tools/hub/victory/interiors.js's output
 * (tools/hub/qjs/compare.js). Runs only when HUB_ROOMS_OUT is set; the cartridges come from HUB_ROMS (a folder with
 * the usual file names) and apicula from APICULA.
 */
class HubRoomsTest {
    @Test fun buildRooms() {
        val out = System.getenv("HUB_ROOMS_OUT"); assumeTrue(out != null)
        val roms = File(System.getenv("HUB_ROMS") ?: "C:/Projects/roms")
        val repo = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "tools/hub").isDirectory }
        val started = System.nanoTime()
        HubRooms.build(
            mapOf("platinum" to File(roms, "Pokemon Platinum Version (US)(XenoPhobia).nds"), "heartgold" to File(roms, "Pokemon HeartGold (U)(Xenophobia).nds"),
                "black2" to File(roms, "Pokemon - Black 2.nds")),
            File(repo, "tools/hub/build/rooms.json"), File(repo, "tools/hub/victory/heights.js"),
            File(System.getenv("APICULA") ?: "C:/Projects/Godot pokemon/tools/apicula/apicula.exe"), File(out!!), File(out, "../rooms-work")
        ) { println(it) }
        println("rooms built in " + (System.nanoTime() - started) / 1_000_000 + " ms")
    }
}
