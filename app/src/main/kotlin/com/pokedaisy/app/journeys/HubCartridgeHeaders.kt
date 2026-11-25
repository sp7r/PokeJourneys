package com.pokedaisy.app.journeys

/** The base versions used by the island builder, checked without relying on file names. */
internal object HubCartridgeHeaders {
    data class Game(val key: String, val name: String, val version: String, val code: String)
    data class Match(val game: Game, val problems: List<String>)

    val games = listOf(
        Game("firered", "FireRed", "English Rev 1", "BPRE"),
        Game("heartgold", "HeartGold", "US", "IPKE"),
        Game("platinum", "Platinum", "US", "CPUE"),
        Game("black", "Black", "English", "IRBO"),
        Game("black2", "Black 2", "English", "IREO"),
    )

    fun inspect(header: ByteArray): Match? {
        if (header.size < 0x200) return null
        fun ascii(at: Int, size: Int) = String(header, at, size, Charsets.US_ASCII)
        val gbaCode = ascii(0xac, 4)
        val dsCode = ascii(0x0c, 4)
        val gbaTitle = ascii(0xa0, 12).trimEnd('\u0000', ' ')
        val dsTitle = ascii(0, 12).trimEnd('\u0000', ' ')
        val key = when {
            gbaCode.startsWith("BPR") || gbaCode.startsWith("BPG") || gbaTitle == "POKEMON FIRE" -> "firered"
            dsCode.startsWith("IPK") || dsCode.startsWith("IPG") || dsTitle == "POKEMON HG" -> "heartgold"
            dsCode.startsWith("CPU") || dsTitle == "POKEMON PL" -> "platinum"
            dsCode.startsWith("IRB") || dsCode.startsWith("IRA") || dsTitle == "POKEMON B" -> "black"
            dsCode.startsWith("IRE") || dsCode.startsWith("IRD") || dsTitle == "POKEMON B2" -> "black2"
            else -> return null
        }
        val game = games.first { it.key == key }
        val code = if (key == "firered") gbaCode else dsCode
        val shownCode = code.map { if (it in 'A'..'Z' || it in '0'..'9') it else '?' }.joinToString("")
        val problems = mutableListOf<String>()
        val otherGame = when (code.take(3)) {
            "BPG" -> "LeafGreen"
            "IPG" -> "SoulSilver"
            "IRA" -> "White"
            "IRD" -> "White 2"
            else -> null
        }
        if (otherGame != null) {
            problems += "$otherGame ($shownCode) is not ${game.name}."
        } else {
            if (code != game.code) {
                val region = when (code.lastOrNull()) {
                    'J' -> "Japanese"
                    'D' -> "German"
                    'F' -> "French"
                    'I' -> "Italian"
                    'S' -> "Spanish"
                    'K' -> "Korean"
                    'P' -> "European"
                    'E', 'O' -> "English"
                    else -> "Unknown region"
                }
                problems += "$region ${game.name}: code $shownCode."
                problems += "Needs ${game.version}, code ${game.code}."
            }
            if (key == "firered") {
                val revision = header[0xbc].toInt() and 0xff
                if (revision != 1) problems += "FireRed Rev $revision instead of Rev 1."
            }
        }
        return Match(game, problems)
    }
}
