package app.lifegame.core.format

import app.lifegame.core.model.Status
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FormatTest {
    private val sample = """{"day":{"id":7,"status":"open","endsAt":"2026-10-26T17:30:00Z","tasksRequired":2,"requiredDone":1},
      "budget":{"remainingMinutes":25},"baseline":false}"""

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

    @Test fun formatsALiveCountdown() {
        assertEquals("10:28:57", Format.clock((10 * 3600 + 28 * 60 + 57) * 1000L))
        assertEquals("0:00:05", Format.clock(5_000))
        assertEquals("0:00:00", Format.clock(-4_000))
    }
}
