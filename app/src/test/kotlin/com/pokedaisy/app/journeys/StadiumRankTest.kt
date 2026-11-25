package com.pokedaisy.app.journeys

import com.pokedaisy.app.companion.data.RomArt
import com.pokedaisy.app.journeys.StadiumRank.Tier
import org.junit.Assert.assertEquals
import org.junit.Test

class StadiumRankTest {
    @Test
    fun badgeStarsUseTheSameWinMilestonesForEveryColor() {
        assertEquals(1, StadiumRank().rating)
        val milestones = listOf(0, 5, 20, 50, 100, 300, 1000)
        for (tier in Tier.entries) {
            milestones.forEachIndexed { stars, wins ->
                assertEquals(StadiumRank.Badge(tier, stars), StadiumRank(tier.requiredRating, wins).badge)
                if (wins > 0) assertEquals(stars - 1, StadiumRank(tier.requiredRating, wins - 1).badge.stars)
            }
            assertEquals(6, StadiumRank(tier.requiredRating, 2000).badge.stars)
        }
    }

    @Test
    fun badgeColorDependsOnlyOnPeakRating() {
        assertEquals(Tier.BRONZE, StadiumRank(19, 1000).badge.tier)
        assertEquals(Tier.SILVER, StadiumRank(20).badge.tier)
        assertEquals(Tier.SILVER, StadiumRank(34, 1000).badge.tier)
        assertEquals(Tier.GOLD, StadiumRank(35).badge.tier)
        assertEquals(Tier.GOLD, StadiumRank(49, 1000).badge.tier)
        assertEquals(Tier.DIAMOND, StadiumRank(50).badge.tier)
        assertEquals(StadiumRank.Badge(Tier.DIAMOND, 6), StadiumRank(40, 1000, 50).badge)
    }

    @Test
    fun matchResultsBoundRatingAndKeepEarnedBadgesAndWinPoints() {
        val promoted = StadiumRank(49, 599).afterBattle(won = true, rankedRating = 52)
        assertEquals(StadiumRank(50, 600), promoted)

        val afterLoss = promoted.afterBattle(won = false, rankedRating = 48)
        assertEquals(StadiumRank(48, 600, 50), afterLoss)
        assertEquals(promoted.badge, afterLoss.badge)
        assertEquals(1, StadiumRank().afterBattle(won = false, rankedRating = 0).rating)
        assertEquals(601, promoted.afterBattle(won = true, rankedRating = 50).winPoints)
    }

    @Test
    fun botWinsEarnExperienceAndLeaveRatingAlone() {
        val before = StadiumRank(rating = 18, winPoints = 999, highestRating = 20)
        val won = before.afterBattle(won = true)
        assertEquals(StadiumRank(rating = 18, winPoints = 1000, highestRating = 20), won)
        assertEquals(StadiumRank.Badge(Tier.SILVER, 6), won.badge)
        assertEquals(won, won.afterBattle(won = false))
    }

    @Test
    fun eachPlaylistKeepsItsOwnRatingAndTheCardShowsTheBest() {
        val start = StadiumRank()
        val singles = start.afterBattle(won = true, rankedRating = 12, playlist = "random_singles")
        val doubles = singles.afterBattle(won = true, rankedRating = 30, playlist = "open_doubles")
        assertEquals(30, doubles.rating)
        assertEquals("open_doubles", doubles.ratingPlaylist)
        assertEquals(2, doubles.winPoints)
        val drop = doubles.afterBattle(won = false, rankedRating = 8, playlist = "open_doubles")
        assertEquals(12, drop.rating)
        assertEquals("random_singles", drop.ratingPlaylist)
        assertEquals(30, drop.highestRating)
        assertEquals(Tier.SILVER, drop.badge.tier)
        assertEquals(StadiumRank.Standing(8, 30), drop.playlists["open_doubles"])
        assertEquals(drop.playlists, drop.afterBattle(won = true).playlists)
        assertEquals(3, drop.afterBattle(won = true).winPoints)
    }

    @Test
    fun playlistsRoundTripThroughTheStandingsFileAndOldFilesStillRead() {
        val rank = StadiumRank().afterBattle(won = true, rankedRating = 41, playlist = "random_doubles")
        val data = StadiumRank.toJson(rank, org.json.JSONObject().put("botResults", org.json.JSONArray()))
        assertEquals(rank, StadiumRank.fromJson(org.json.JSONObject(data.toString())))
        val old = org.json.JSONObject().put("rating", 18).put("winPoints", 7).put("highestRating", 22)
        assertEquals(StadiumRank(18, 7, 22), StadiumRank.fromJson(old))
    }

    @Test
    fun sheetCropUsesDecodedBackgroundColors() {
        val gridColor = 0xFF00817F.toInt()
        val cellColor = 0xFF5189B1.toInt()
        val bronze = 0xFFD08058.toInt()
        val sheet = RomArt.Image(260, 846, IntArray(260 * 846) { cellColor })
        sheet.argb[0] = gridColor
        sheet.argb[4 * sheet.width + 3] = gridColor
        sheet.argb[5 * sheet.width + 10] = bronze

        val emblem = requireNotNull(StadiumRankBadge.fromSheet(sheet, StadiumRank().badge))
        assertEquals(listOf(bronze), emblem.argb.filter { it != 0 })
        assertEquals(bronze, emblem.argb[emblem.width * 2 + 8])
    }
}
