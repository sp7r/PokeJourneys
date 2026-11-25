package com.pokedaisy.app.journeys

import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

/**
 * The hub's music, made from the player's DS cartridges: each song is rendered from the game's sound archive by
 * libhubmusic.so (app/src/main/cpp/journeys/music) into data/music/<song>.qoa, with its loop in music/music.json.
 * Which song plays where is the hub's own layout.json ("music").
 */
object HubMusic {

    private class Song(val name: String, val game: String, val archive: String, val sequence: Int)

    // The sequence numbers are the games' own (their sound archives' SEQ_ numbers).
    private val SONGS = listOf(
        Song("island", "heartgold", "data/sound/gs_sound_data.sdat", 1050), // Route 1
        Song("mart", "heartgold", "data/sound/gs_sound_data.sdat", 1063), // Pokémon Center
        Song("vault", "black", "wb_sound_data.sdat", 1158),               // GTS
        Song("tms", "black2", "swan_sound_data.sdat", 1203),              // Pokéstar Studios
        Song("cosmetics", "black2", "swan_sound_data.sdat", 1108),        // Pokémon Musical dressing room
        Song("tutor", "platinum", "data/sound/pl_sound_data.sdat", 1089), // Contest Hall
        Song("auction", "heartgold", "data/sound/gs_sound_data.sdat", 1044), // Pewter City
        Song("tent", "heartgold", "data/sound/gs_sound_data.sdat", 1150),  // Mystery Gift
        Song("battle", "black2", "swan_sound_data.sdat", 1200),           // Pokémon World Tournament lobby
        Song("gamecorner", "heartgold", "data/sound/gs_sound_data.sdat", 1069), // Game Corner
        Song("trainertower", "platinum", "data/sound/pl_sound_data.sdat", 1092), // Battle Tower
        Song("chamber", "platinum", "data/sound/pl_sound_data.sdat", 1072),     // Spear Pillar
        Song("daycare", "platinum", "data/sound/pl_sound_data.sdat", 1015),     // Solaceon Town
    )

    private external fun render(rom: String, offset: Long, length: Long, sequence: Int, out: String): LongArray

    /** Renders every song into data/music; music.json is written last, once all of them are there. */
    fun build(roms: Map<String, File>, data: File, log: (String) -> Unit = {}) {
        System.loadLibrary("hubmusic")
        val dir = File(data, "music")
        dir.deleteRecursively(); dir.mkdirs()
        val places = SONGS.associate { song ->
            song.name to HubRooms.Rom(roms.getValue(song.game)).use { it.place(song.archive) }
        }
        val pool = Executors.newFixedThreadPool(3)
        try {
            val jobs = SONGS.map { song ->
                song to pool.submit<LongArray> {
                    val at = places.getValue(song.name)
                    render(roms.getValue(song.game).path, at[0], at[1], song.sequence, File(dir, song.name + ".qoa").path)
                }
            }
            val list = JSONObject()
            for ((song, job) in jobs) {
                val r = job.get()
                list.put(song.name, JSONObject().put("frames", r[0]).put("loopBegin", r[1]).put("loopEnd", r[2]).put("rate", r[3]))
                log("${song.name}: ${r[0] / r[3]} s")
            }
            File(dir, "music.json").writeText(list.toString(2) + "\n")
        } finally { pool.shutdownNow() }
    }
}
