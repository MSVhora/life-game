package app.lifegame.core.usage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionBuilderTest {
    private fun ev(sec: Long, pkg: String?, type: Int) = RawEvent(sec * 1000, pkg, type)
    private val R = EventType.ACTIVITY_RESUMED
    private val P = EventType.ACTIVITY_PAUSED

    @Test fun resumeThenPauseIsOneSession() {
        val b = SessionBuilder.build(listOf(ev(100, "a", R), ev(160, "a", P)), 1_000_000)
        assertEquals(listOf(Session("a", 100_000, 160_000, false)), b.sessions)
        assertNull(b.open)
    }

    @Test fun switchingAppsEndsThePreviousOneWithoutAPause() {
        val b = SessionBuilder.build(listOf(ev(100, "a", R), ev(200, "b", R), ev(300, "b", P)), 1_000_000)
        assertEquals(listOf("a" to 100.0, "b" to 100.0), b.sessions.map { it.pkg to it.seconds })
    }

    @Test fun screenOffClosesTheSessionAndIsRecorded() {
        val b = SessionBuilder.build(listOf(ev(100, "a", R), ev(190, null, EventType.SCREEN_NON_INTERACTIVE)), 1_000_000)
        assertEquals(90.0, b.sessions.single().seconds, 0.0)
        assertEquals(listOf(ScreenEvent("screen_off", 190_000)), b.screen)
        assertNull(b.open)
    }

    @Test fun recordsScreenOnAndUnlock() {
        val b = SessionBuilder.build(listOf(ev(10, null, EventType.SCREEN_INTERACTIVE), ev(12, null, EventType.KEYGUARD_HIDDEN), ev(13, null, EventType.KEYGUARD_SHOWN)), 100_000)
        assertEquals(listOf("screen_on" to 10_000L, "unlock" to 12_000L), b.screen.map { it.kind to it.ts })
    }

    @Test fun anAppStillInTheForegroundIsOngoingUntilNow() {
        val b = SessionBuilder.build(listOf(ev(100, "a", R)), 400_000)
        val s = b.sessions.single()
        assertTrue(s.ongoing); assertEquals(400_000, s.end)
        assertEquals(OpenSession("a", 100_000), b.open)
    }

    @Test fun joinsPauseResumePairsOfTheSameApp() {
        val b = SessionBuilder.build(listOf(ev(100, "a", R), ev(160, "a", P), ev(161, "a", R), ev(220, "a", P)), 1_000_000)
        assertEquals(1, b.sessions.size)
        assertEquals(120.0, b.sessions[0].seconds, 0.0)
    }

    @Test fun keepsSeparateSessionsWhenTheGapIsReal() {
        val b = SessionBuilder.build(listOf(ev(100, "a", R), ev(160, "a", P), ev(400, "a", R), ev(460, "a", P)), 1_000_000)
        assertEquals(2, b.sessions.size)
    }

    @Test fun ignoresSystemUiAndEndsTheSessionBeforeIt() {
        val b = SessionBuilder.build(listOf(ev(100, "a", R), ev(150, "com.android.systemui", R), ev(200, "com.android.systemui", P)), 1_000_000)
        assertEquals(listOf("a"), b.sessions.map { it.pkg })
        assertEquals(50.0, b.sessions[0].seconds, 0.0)
    }

    @Test fun dropsSessionsShorterThanASecond() {
        val b = SessionBuilder.build(listOf(RawEvent(100_000, "a", R), RawEvent(100_400, "a", P)), 1_000_000)
        assertTrue(b.sessions.isEmpty())
    }

    @Test fun aPauseForAnotherAppChangesNothing() {
        val b = SessionBuilder.build(listOf(ev(100, "a", R), ev(120, "b", P), ev(200, "a", P)), 1_000_000)
        assertEquals(100.0, b.sessions.single().seconds, 0.0)
    }

    @Test fun ignoresAnOrphanPauseAtTheStartOfTheWindow() {
        val b = SessionBuilder.build(listOf(ev(100, "a", P), ev(150, "b", R), ev(180, "b", P)), 1_000_000)
        assertEquals(listOf("b"), b.sessions.map { it.pkg })
    }

    @Test fun handlesUnsortedInput() {
        val b = SessionBuilder.build(listOf(ev(160, "a", P), ev(100, "a", R)), 1_000_000)
        assertEquals(60.0, b.sessions.single().seconds, 0.0)
    }

    @Test fun shutdownClosesTheSession() {
        val b = SessionBuilder.build(listOf(ev(100, "a", R), ev(130, null, EventType.DEVICE_SHUTDOWN), ev(900, "b", R)), 1_000_000)
        assertEquals(30.0, b.sessions.first { it.pkg == "a" }.seconds, 0.0)
        assertNotNull(b.open)
    }

    @Test fun anEmptyWindowGivesNothing() {
        val b = SessionBuilder.build(emptyList(), 1000)
        assertTrue(b.sessions.isEmpty() && b.screen.isEmpty()); assertNull(b.open)
    }
}
