package com.pokedaisy.app.journeys

import java.io.File
import org.json.JSONObject

/**
 * The trainer's ranked Stadium standing, like Halo 3's: each ranked playlist keeps its own Rating (1-50), Experience
 * is shared by every playlist and venue, and the card shows the trainer's best Rating. Peak Rating in any playlist sets
 * the color and Experience sets the stars.
 */
data class StadiumRank(
    val rating: Int = MIN_RATING,
    val winPoints: Int = 0,
    val highestRating: Int = rating,
    val playlists: Map<String, Standing> = emptyMap(),
) {
    init {
        require(rating in MIN_RATING..MAX_RATING && highestRating in rating..MAX_RATING && winPoints >= 0)
    }

    /** One playlist's current and peak Rating. */
    data class Standing(val rating: Int = MIN_RATING, val highestRating: Int = rating)

    /** The playlist the shown Rating comes from, when any ranked playlist has been played. */
    val ratingPlaylist: String?
        get() = playlists.maxByOrNull { it.value.rating }?.key

    val badge: Badge
        get() {
            val tier = Tier.entries.last { highestRating >= it.requiredRating }
            return Badge(tier, starThresholds.count { winPoints >= it })
        }

    /**
     * Applies a Stadium result. A ranked PvP result carries the playlist and the Rating calculated by the match
     * service; bot battles and casual matches only add Experience.
     */
    fun afterBattle(won: Boolean, rankedRating: Int? = null, playlist: String? = null): StadiumRank {
        val nextWinPoints = if (won && winPoints < Int.MAX_VALUE) winPoints + 1 else winPoints
        if (rankedRating == null) return copy(winPoints = nextWinPoints)
        val bounded = rankedRating.coerceIn(MIN_RATING, MAX_RATING)
        if (playlist == null) return StadiumRank(bounded, nextWinPoints, maxOf(highestRating, bounded), playlists)
        val before = playlists[playlist] ?: Standing()
        return of(nextWinPoints, playlists + (playlist to Standing(bounded, maxOf(before.highestRating, bounded))), highestRating)
    }

    data class Badge(val tier: Tier, val stars: Int)

    enum class Tier(val requiredRating: Int) {
        BRONZE(1), SILVER(20), GOLD(35), DIAMOND(50),
    }

    companion object {
        const val MIN_RATING = 1
        const val MAX_RATING = 50
        private val starThresholds = listOf(5, 20, 50, 100, 300, 1000)

        /** The ranked playlists, by the id the match service and the Stadium signup use. */
        val PLAYLISTS = linkedMapOf(
            "random_singles" to "Random Singles",
            "random_doubles" to "Random Doubles",
            "open_singles" to "Open Singles",
            "open_doubles" to "Open Doubles",
        )

        /** The shown Rating is the best playlist's; the peak is the best ever in any playlist. */
        fun of(winPoints: Int, playlists: Map<String, Standing>, earlierPeak: Int = MIN_RATING): StadiumRank {
            val rating = playlists.values.maxOfOrNull { it.rating } ?: MIN_RATING
            val peak = maxOf(earlierPeak, rating, playlists.values.maxOfOrNull { it.highestRating } ?: MIN_RATING)
            return StadiumRank(rating, winPoints, peak, playlists)
        }

        internal fun fromJson(snapshot: JSONObject): StadiumRank {
            val winPoints = snapshot.optInt("winPoints", 0)
            val saved = snapshot.optJSONObject("playlists")
            // Files from before playlists (or with none played yet) keep their single Rating.
            if (saved == null || saved.length() == 0) {
                val rating = snapshot.optInt("rating", MIN_RATING).coerceIn(MIN_RATING, MAX_RATING)
                return StadiumRank(rating, winPoints, snapshot.optInt("highestRating", rating).coerceIn(rating, MAX_RATING))
            }
            val playlists = saved.keys().asSequence().filter { it in PLAYLISTS }.associateWith { id ->
                val entry = saved.getJSONObject(id)
                val rating = entry.getInt("rating").coerceIn(MIN_RATING, MAX_RATING)
                Standing(rating, entry.optInt("highestRating", rating).coerceIn(rating, MAX_RATING))
            }
            return of(winPoints, playlists, snapshot.optInt("highestRating", MIN_RATING).coerceIn(MIN_RATING, MAX_RATING))
        }

        /** Writes the standing into [data], keeping its other fields (such as recorded bot match ids). */
        internal fun toJson(rank: StadiumRank, data: JSONObject): JSONObject {
            val playlists = JSONObject()
            for ((id, standing) in rank.playlists) {
                playlists.put(id, JSONObject().put("rating", standing.rating).put("highestRating", standing.highestRating))
            }
            data.put("rating", rank.rating).put("winPoints", rank.winPoints).put("highestRating", rank.highestRating)
            return if (rank.playlists.isEmpty()) data else data.put("playlists", playlists)
        }

        /** Reads the account's last ranked standings snapshot when one is available. */
        internal fun read(accountDir: File): StadiumRank = runCatching {
            fromJson(JSONObject(File(accountDir, "stadium-rank.json").readText()))
        }.getOrDefault(StadiumRank())
    }
}
