package com.pokedaisy.app.journeys

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WeeklySightingTest {
    @Test
    fun requestsRotateThroughEightCluesWithoutGivingAwayTheChain() {
        val week = 2_967L
        val clues = (1..6).map { step -> WeeklySighting.prompt(week, WeeklySighting.Request(step, 25), "Pikachu") }
        assertEquals(6, clues.toSet().size)
        assertTrue(clues.take(5).all { it.contains("Pikachu") && !it.contains("Shiny") })
        assertTrue(clues.last().contains("Shiny Pikachu"))
        assertTrue(clues.none { it.any(Char::isDigit) || it.contains("final", ignoreCase = true) })
        assertEquals(8, (0L..7L).map { WeeklySighting.prompt(it, WeeklySighting.Request(1, 25), "Pikachu") }.toSet().size)
    }

    @Test
    fun weeklyRequestsAreDistinctAndTheFinaleCanUseAnySpecies() {
        fun lineUp(week: Long) = (0..5).map { completed ->
            requireNotNull(WeeklySighting.Rewards(week, completed).nextRequest(week))
        }

        val thisWeek = lineUp(2_967)
        val nextWeek = lineUp(2_968)
        assertEquals((1..6).toList(), thisWeek.map { it.number })
        assertTrue(thisWeek.take(5).none { it.shiny })
        assertTrue(thisWeek.last().shiny)
        assertEquals(6, thisWeek.map { it.species }.toSet().size)
        assertTrue(thisWeek.map { it.species }.intersect(nextWeek.map { it.species }.toSet()).isEmpty())
        assertEquals(thisWeek, lineUp(2_967))
        assertEquals((1..807).toSet(), (0L until 807L).map { lineUp(it).last().species }.toSet())
    }

    @Test
    fun fiveMatchesUnlockOneShinyRewardAndThenTheWeekIsDone() {
        val week = 2_967L
        var journal = WeeklySighting.Rewards()
        val finale = requireNotNull(WeeklySighting.Rewards(week, completed = 5).nextRequest(week))
        val shiny = WeeklySighting.Follower(finale.species, shiny = true)
        assertNull(journal.claim(week, null))
        assertNull(journal.claim(week, shiny))

        repeat(5) { completed ->
            val request = requireNotNull(journal.nextRequest(week))
            val follower = WeeklySighting.Follower(request.species, shiny = completed == 0)
            journal = requireNotNull(journal.claim(week, follower))
            assertEquals(WeeklySighting.Rewards(week, completed + 1, stamps = completed + 1), journal)
            assertNull(journal.claim(week, follower))
        }

        assertEquals(finale, journal.nextRequest(week))
        assertNull(journal.claim(week, shiny.copy(shiny = false)))
        val finished = requireNotNull(journal.claim(week, shiny))
        assertEquals(WeeklySighting.Rewards(week, completed = 6, stamps = 5, medals = 1), finished)
        assertNull(finished.nextRequest(week))
        assertNull(finished.claim(week, shiny))
        assertNull(finished.claim(week - 1, shiny))
        val next = requireNotNull(finished.nextRequest(week + 1))
        assertEquals(1, next.number)
        assertFalse(next.shiny)
        val restarted = requireNotNull(finished.claim(week + 1, WeeklySighting.Follower(next.species, shiny = false)))
        assertEquals(WeeklySighting.Rewards(week + 1, completed = 1, stamps = 6, medals = 1), restarted)
    }

    @Test
    fun mondayStartsAFreshChainEvenWhenLastWeekWasIncomplete() {
        val sunday = LocalDate.of(2024, 12, 29)
        val monday = sunday.plusDays(1)
        val oldWeek = WeeklySighting.weekOf(sunday)
        val newWeek = WeeklySighting.weekOf(monday)
        assertEquals(oldWeek + 1, newWeek)
        assertEquals(newWeek, WeeklySighting.weekOf(monday.plusDays(6)))
        assertEquals(newWeek + 1, WeeklySighting.weekOf(monday.plusWeeks(1)))

        val progress = WeeklySighting.Rewards(oldWeek, completed = 2, stamps = 2)
        assertEquals(3, progress.nextRequest(oldWeek)?.number)
        assertEquals(1, progress.nextRequest(newWeek)?.number)
    }
}
