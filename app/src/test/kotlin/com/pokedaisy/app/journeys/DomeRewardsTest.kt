package com.pokedaisy.app.journeys

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class DomeRewardsTest {
    @get:Rule val folder = TemporaryFolder()
    @Test fun winsAddExperienceOnceAndPreserveBothRatings() {
        val root = folder.newFolder()
        val file = File(root, "stadium-rank.json")
        file.writeText(JSONObject().put("rating", 12).put("highestRating", 35).put("winPoints", 19).toString())
        val id = "a".repeat(32)
        val won = DomeRewards.recordWin(root, id)
        assertEquals(StadiumRank(12, 20, 35), won)
        assertEquals(won, DomeRewards.recordWin(root, id))
        assertEquals(StadiumRank(12, 21, 35), DomeRewards.recordWin(root, "b".repeat(32)))
        assertFalse(File(root, "stadium-rank.json.tmp").exists())
    }
    @Test fun newTrainersStartAtRatingOneAndMalformedSnapshotsArePreserved() {
        val root = folder.newFolder()
        assertEquals(StadiumRank(1, 1, 1), DomeRewards.recordWin(root, "a".repeat(32)))
        val file = File(root, "stadium-rank.json")
        file.writeText("broken snapshot")
        assertTrue(runCatching { DomeRewards.recordWin(root, "b".repeat(32)) }.isFailure)
        assertEquals("broken snapshot", file.readText())
    }
}
