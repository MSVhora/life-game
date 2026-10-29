package app.lifegame.core.usage

import app.lifegame.core.json.Json
import app.lifegame.core.json.asMap

import org.junit.Assert.assertEquals
import org.junit.Test

class EventMapperTest {
    @Test fun sessionBecomesAnAppUsageEvent() {
        val e = EventMapper.session(Session("com.x.game", 1_700_000_000_000, 1_700_000_090_500, false), "Clash \"Test\"")
        assertEquals("com.x.game:1700000000000", e.key)
        val m = Json.parse(e.json).asMap()!!
        assertEquals("android", m["source"]); assertEquals("app_usage", m["kind"]); assertEquals(e.key, m["key"])
        assertEquals("2023-11-14T22:13:20Z", m["ts"])
        assertEquals(90.5, m["durationSec"])
        assertEquals(mapOf("app" to "Clash \"Test\"", "package" to "com.x.game"), m["data"])
    }

    @Test fun screenEventsHaveNoDuration() {
        val e = EventMapper.screen(ScreenEvent("unlock", 1_700_000_000_000))
        assertEquals("unlock:1700000000000", e.key)
        val m = Json.parse(e.json).asMap()!!
        assertEquals("unlock", m["kind"]); assertEquals(0.0, m["durationSec"]); assertEquals(emptyMap<String, Any?>(), m["data"])
    }

    @Test fun aGrowingSessionKeepsItsKey() {
        val a = EventMapper.session(Session("p", 5000, 8000, true), "P")
        val b = EventMapper.session(Session("p", 5000, 99000, true), "P")
        assertEquals(a.key, b.key)
    }
}
