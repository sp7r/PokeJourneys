package com.pokedaisy.app.journeys

import android.content.Context
import android.util.AtomicFile
import com.pokedaisy.app.companion.i18n.tr
import java.io.File
import java.io.FileNotFoundException
import java.time.LocalDate
import kotlin.random.Random
import org.json.JSONArray
import org.json.JSONObject

/** The courtyard spotter's weekly requests and each trainer's collectible rewards. */
internal object WeeklySighting {
    private const val LAST_SPECIES = 807
    private const val REGULAR_SIGHTINGS = 5
    private const val TOTAL_SIGHTINGS = REGULAR_SIGHTINGS + 1
    private val speciesOrder = (1..LAST_SPECIES).shuffled(Random(2_528_099))
    private val requestLines = listOf(
        "I'd love to see {0}!",
        "I keep hoping I'll spot {0} around here...",
        "One of my favorite Pokémon is {0}!",
        "Have you ever seen {0} up close?",
        "I've been looking everywhere for {0}!",
        "I'd keep my camera ready if {0} were around.",
        "You know who'd make my day? {0}!",
        "Imagine running into {0} right here!",
    )

    data class Request(val number: Int, val species: Int) {
        val shiny: Boolean get() = number == TOTAL_SIGHTINGS
    }

    data class Follower(val species: Int, val shiny: Boolean)

    data class Rewards(val week: Long = Long.MIN_VALUE, val completed: Int = 0, val stamps: Int = 0, val medals: Int = 0) {
        fun nextRequest(currentWeek: Long): Request? {
            if (currentWeek < week) return null
            val step = if (currentWeek == week) completed else 0
            if (step >= TOTAL_SIGHTINGS) return null

            // Leave one gap between weeks so all six species change and every species can be the finale.
            val start = Math.floorMod(currentWeek, LAST_SPECIES.toLong()).toInt() * (TOTAL_SIGHTINGS + 1)
            return Request(step + 1, speciesOrder[(start + step) % LAST_SPECIES])
        }

        fun claim(currentWeek: Long, follower: Follower?): Rewards? {
            val request = nextRequest(currentWeek) ?: return null
            if (follower == null || follower.species != request.species || (request.shiny && !follower.shiny)) return null
            return if (request.shiny) copy(week = currentWeek, completed = request.number, medals = medals + 1)
            else copy(week = currentWeek, completed = request.number, stamps = stamps + 1)
        }
    }

    // The first Monday of the epoch week was 1969-12-29, three days before day zero.
    fun weekOf(date: LocalDate): Long = Math.floorDiv(date.toEpochDay() + 3L, 7L)

    /** Reads and claims together so two conversations cannot grant the same reward. Blocking. */
    @Synchronized
    fun speak(context: Context, active: HubFollower.Identity?): String {
        val week = weekOf(LocalDate.now())
        val account = DiscordSignIn.accountId(context.filesDir)
        val file = AtomicFile(File(context.filesDir, "accounts/$account/sighting-rewards.json"))
        val rewards = read(file)
        val request = rewards.nextRequest(week)
        if (request == null) return withCollection(listOf(satisfied()), rewards)

        val name = speciesName(context, request)
        val follower = active?.takeIf { it.account == account }?.let { HubFollower.entry(context, it.id) }?.let {
            // Vault summaries end in a star for shiny entries. Vault entries never contain eggs.
            Follower(it.getInt("species"), it.optString("summary").endsWith(" ★"))
        }
        val claimed = rewards.claim(week, follower)
        val wanted = if (request.shiny) tr("Shiny {0}", name) else name
        val pages = when {
            claimed != null -> {
                val reward = if (request.shiny) tr("Prism Medal") else tr("Sighting Stamp")
                val next = claimed.nextRequest(week)
                val nextPage = if (next == null) satisfied() else prompt(week, next, speciesName(context, next))
                write(file, claimed)
                listOf(tr("That's {0}! Thanks for bringing it to see me!", wanted),
                    tr("You received a {0}!", reward), nextPage)
            }
            request.shiny && follower?.species == request.species ->
                listOf(tr("That's {0}! I wonder what it looks like in its shiny colors.", name))
            else -> listOf(prompt(week, request, name))
        }
        return if (claimed == null) JSONArray(pages).toString() else withCollection(pages, claimed)
    }

    private fun speciesName(context: Context, request: Request): String {
        val lookup = JourneysBridge.run(context, "species-name", request.species.toString())
        check(lookup.ok && lookup.output.isNotBlank())
        return lookup.output
    }

    fun prompt(week: Long, request: Request, name: String): String {
        val start = Math.floorMod(week, requestLines.size.toLong()).toInt()
        val line = requestLines[(start + request.number - 1) % requestLines.size]
        val wanted = if (request.shiny) tr("Shiny {0}", name) else name
        return tr(line, wanted)
    }

    private fun satisfied(): String = tr("My journal is full for this week. Come back on Monday!")

    private fun withCollection(pages: List<String>, rewards: Rewards): String = JSONArray(
        if (rewards.stamps > 0 || rewards.medals > 0) {
            pages + tr("Your collection has {0} Sighting Stamps and {1} Prism Medals.", rewards.stamps, rewards.medals)
        } else {
            pages
        }
    ).toString()

    private fun read(file: AtomicFile): Rewards {
        val bytes = try {
            file.readFully()
        } catch (missing: FileNotFoundException) {
            if (file.baseFile.exists()) throw missing
            return Rewards()
        }
        val json = JSONObject(bytes.decodeToString())
        // The earlier daily journal only stored the last claim and the collection totals.
        val week = if (json.has("week")) json.getLong("week") else Long.MIN_VALUE
        val completed = if (json.has("week")) json.getInt("completed") else 0
        check(completed in 0..TOTAL_SIGHTINGS)
        return Rewards(week, completed, json.getInt("stamps"), json.getInt("medals"))
    }

    private fun write(file: AtomicFile, rewards: Rewards) {
        val data = JSONObject().put("week", rewards.week).put("completed", rewards.completed)
            .put("stamps", rewards.stamps).put("medals", rewards.medals)
        val stream = file.startWrite()
        try {
            stream.write(data.toString().encodeToByteArray())
            file.finishWrite(stream)
        } catch (error: Exception) {
            file.failWrite(stream)
            throw error
        }
    }
}
