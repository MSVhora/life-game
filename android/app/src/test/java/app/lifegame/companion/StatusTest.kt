package app.lifegame.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class StatusTest {
    private val sample = """{"serverTime":"2026-10-26T06:00:00.000Z","timezone":"Asia/Kolkata",
      "day":{"id":7,"localDate":"2026-10-26","status":"open","endsAt":"2026-10-26T17:30:00.000Z","msLeft":41400000,"tasksRequired":2,"requiredDone":1,"success":false},
      "budget":{"capMinutes":120,"earnedMinutes":60,"usedMinutes":35,"remainingMinutes":25},
      "wake":{"goal":"12:00","today":"2026-10-26T04:00:00.000Z","source":"phone"},
      "timer":{"id":3,"kind":"work","label":null,"startedAt":"2026-10-26T05:30:00.000Z"},
      "baseline":false,"pressure":"gradual","gamingApps":["Clash of Clans","Chess"]}"""

    @Test fun parsesTheServerStatus() {
        val s = Status.parse(sample)
        assertEquals(7L, s.dayId); assertEquals("open", s.dayStatus)
        assertEquals(1793035800000L, s.endsAtMs)
        assertEquals(1, s.requiredDone); assertEquals(2, s.tasksRequired)
        assertEquals(25, s.remainingMin); assertEquals(35, s.usedMin); assertEquals(120, s.capMin)
        assertTrue(s.wakeToday); assertEquals("12:00", s.wakeGoal)
        assertEquals("work", s.timerKind); assertEquals(1792992600000L, s.timerStartedAtMs)
        assertEquals(setOf("Clash of Clans", "Chess"), s.gamingApps)
        assertTrue(s.countsToday)
    }

    @Test fun toleratesMissingOptionalParts() {
        val s = Status.parse("""{"day":{"id":1,"status":"paused","endsAt":"2026-10-26T17:30:00Z"}}""")
        assertNull(s.timerKind); assertFalse(s.wakeToday); assertEquals(emptySet<String>(), s.gamingApps)
        assertFalse(s.countsToday); assertEquals(0, s.remainingMin)
    }

    @Test fun baselineDaysDoNotCount() {
        val s = Status.parse(sample.replace("\"baseline\":false", "\"baseline\":true"))
        assertFalse(s.countsToday)
    }

    @Test fun rejectsGarbage() {
        for (bad in listOf("not json", "[]", """{"budget":{}}""")) {
            try { Status.parse(bad); fail("should reject $bad") } catch (_: Exception) { }
        }
    }

    @Test fun summaryReadsNaturally() {
        assertEquals("1 of 2 tasks · 25 min game time left", Format.summary(Status.parse(sample)))
        assertEquals("Waiting for the server…", Format.summary(null))
        assertTrue(Format.summary(Status.parse(sample.replace("\"baseline\":false", "\"baseline\":true"))).startsWith("Baseline week"))
        assertTrue(Format.summary(Status.parse(sample.replace("\"status\":\"open\"", "\"status\":\"paused\""))).startsWith("Day off"))
    }

    @Test fun formatsDurations() {
        assertEquals("under a minute", Format.duration(30_000))
        assertEquals("5 min", Format.duration(5 * 60_000))
        assertEquals("1 h 05 min", Format.duration(65 * 60_000))
        assertEquals("2 h 00 min", Format.duration(120 * 60_000))
    }
}
