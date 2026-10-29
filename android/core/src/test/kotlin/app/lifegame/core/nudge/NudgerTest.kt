package app.lifegame.core.nudge

import app.lifegame.core.model.Status

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class NudgerTest {
    private fun status(remaining: Int, used: Int = 60, earned: Int = 60, day: String = "open", baseline: Boolean = false, pressure: String = "gradual") = Status(
        dayId = 1, dayStatus = day, endsAtMs = 0, tasksRequired = 2, requiredDone = 1, earnedMin = earned, usedMin = used, remainingMin = remaining,
        capMin = 120, wakeToday = true, wakeGoal = "12:00", timerKind = null, timerStartedAtMs = null, baseline = baseline, pressure = pressure,
        gamingApps = setOf("Clash of Clans"),
    )
    private val game = "Clash of Clans"

    @Test fun warnsOnceWhenGameTimeIsLow() {
        val state = NudgeState()
        val n = Nudger.decide(1000, status(4, used = 56), game, state)
        assertEquals(NudgeKind.LOW, n!!.kind); assertEquals("4 min of game time left", n.title)
        assertNull(Nudger.decide(2000, status(3, used = 57), game, state)) // not again today
    }

    @Test fun warnsAgainOnANewDay() {
        val state = NudgeState()
        Nudger.decide(1000, status(4), game, state)
        val next = status(4).copy(dayId = 2)
        assertNotNull(Nudger.decide(2000, next, game, state))
    }

    @Test fun saysWhenItIsUsedUpAndThenWaitsBeforeRepeating() {
        val state = NudgeState()
        val over = status(0, used = 75, earned = 60)
        val first = Nudger.decide(1_000_000, over, game, state)
        assertEquals(NudgeKind.OVER, first!!.kind); assertEquals("You are 15 min past what you earned. Tomorrow's game time depends on today's tasks.", first.text)
        assertNull(Nudger.decide(1_000_000 + 5 * 60_000, over, game, state))
        assertNotNull(Nudger.decide(1_000_000 + 11 * 60_000, over, game, state))
    }

    @Test fun saysSoPlainlyWhenNothingWasEarnedYet() {
        val n = Nudger.decide(1_000_000, status(0, used = 0, earned = 0), game, NudgeState())!!
        assertEquals("No game time left", n.title); assertEquals("Finish a task to earn some.", n.text)
    }

    @Test fun staysQuietOutsideGameApps() {
        assertNull(Nudger.decide(1000, status(0, used = 80), "Notes", NudgeState()))
        assertNull(Nudger.decide(1000, status(0, used = 80), null, NudgeState()))
    }

    @Test fun staysQuietWhenNothingCountsOrThePlayerChoseDataOnly() {
        assertNull(Nudger.decide(1000, status(0, used = 80, day = "paused"), game, NudgeState()))
        assertNull(Nudger.decide(1000, status(0, used = 80, baseline = true), game, NudgeState()))
        assertNull(Nudger.decide(1000, status(0, used = 80, pressure = "data_only"), game, NudgeState()))
    }

    @Test fun gentleModeIsGentler() {
        val n = Nudger.decide(1_000_000, status(0, used = 70, pressure = "gentle"), game, NudgeState())!!
        assertEquals("You are 10 min past what you earned. Your call.", n.text)
    }

    @Test fun noWarningWhenThereIsPlentyLeft() {
        assertNull(Nudger.decide(1000, status(40, used = 20), game, NudgeState()))
    }
}
