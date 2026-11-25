package com.pokedaisy.app.journeys

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HubCartridgeHeadersTest {
    private fun header(code: String, revision: Int = 0, gba: Boolean = false, title: String = ""): ByteArray =
        ByteArray(0x200).also {
            code.toByteArray(Charsets.US_ASCII).copyInto(it, if (gba) 0xac else 0x0c)
            title.toByteArray(Charsets.US_ASCII).copyInto(it, if (gba) 0xa0 else 0)
            it[0xbc] = revision.toByte()
        }

    @Test fun acceptsOnlyTheFiveRequiredCodesAndFireRedRevision() {
        for (game in HubCartridgeHeaders.games) {
            val match = HubCartridgeHeaders.inspect(header(game.code, 1, game.key == "firered"))!!
            assertEquals(game.key, match.game.key)
            assertTrue(match.problems.isEmpty())
        }
        assertEquals(5, HubCartridgeHeaders.games.size)
    }

    @Test fun explainsFireRedRevisionWithoutTreatingTheByteAsSigned() {
        for (revision in listOf(0, 2, 255)) {
            val match = HubCartridgeHeaders.inspect(header("BPRE", revision, gba = true))!!
            assertEquals(listOf("FireRed Rev $revision instead of Rev 1."), match.problems)
        }
        val japanese = HubCartridgeHeaders.inspect(header("BPRJ", 0, gba = true))!!
        assertTrue(japanese.problems.any { it.contains("Japanese FireRed") })
        assertTrue(japanese.problems.any { it.contains("Rev 0 instead of Rev 1") })
    }

    @Test fun explainsRegionsAndEnglishCodesThatAreNotTheRequiredCode() {
        for ((code, name, region, required) in listOf(
            listOf("IPKJ", "HeartGold", "Japanese", "IPKE"),
            listOf("IPKP", "HeartGold", "European", "IPKE"),
            listOf("CPUD", "Platinum", "German", "CPUE"),
            listOf("CPUP", "Platinum", "European", "CPUE"),
            listOf("IRBE", "Black", "English", "IRBO"),
            listOf("IREE", "Black 2", "English", "IREO"),
        )) {
            val problems = HubCartridgeHeaders.inspect(header(code))!!.problems
            assertTrue(problems.any { it.contains("$region $name") && it.contains(code) })
            assertTrue(problems.any { it.contains("Needs") && it.contains(required) })
        }
    }

    @Test fun pairedGamesDoNotCountAsBases() {
        for ((code, other, required) in listOf(
            Triple("BPGE", "LeafGreen", "FireRed"), Triple("IPGE", "SoulSilver", "HeartGold"),
            Triple("IRAO", "White", "Black"), Triple("IRDO", "White 2", "Black 2"),
        )) {
            val match = HubCartridgeHeaders.inspect(header(code, 1, code == "BPGE"))!!
            assertEquals(listOf("$other ($code) is not $required."), match.problems)
        }
    }

    @Test fun internalTitleExplainsAnUnexpectedGameCode() {
        val match = HubCartridgeHeaders.inspect(header("ABCE", title = "POKEMON HG"))!!
        assertEquals("heartgold", match.game.key)
        assertTrue(match.problems.any { it.contains("ABCE") })
        assertTrue(match.problems.any { it.contains("IPKE") })
    }

    @Test fun ignoresUnrelatedAndTruncatedHeaders() {
        assertNull(HubCartridgeHeaders.inspect(header("ADAE")))
        assertNull(HubCartridgeHeaders.inspect(header("BPEE", gba = true)))
        assertNull(HubCartridgeHeaders.inspect(header("BPRE", 1, gba = true).copyOf(0x100)))
        assertNull(HubCartridgeHeaders.inspect(byteArrayOf()))
    }
}
