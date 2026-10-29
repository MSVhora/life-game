package app.lifegame.companion.ui.today

import app.lifegame.companion.MainDispatcherRule
import app.lifegame.companion.RepoFixture
import app.lifegame.core.model.TimerKind
import app.lifegame.core.net.ApiException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class TodayViewModelTest {
    @get:Rule val main = MainDispatcherRule()

    private fun vm(f: RepoFixture) = TodayViewModel(f.repository)

    /** Waits for the next message the view model sends for a snackbar. */
    private fun nextMessage(vm: TodayViewModel): String = runBlocking { withTimeout(5_000) { vm.messages.first() } }

    @Test fun startsUnconfigured() {
        val vm = vm(RepoFixture(configured = false))
        assertFalse(vm.uiState.value.configured)
        assertNull(vm.uiState.value.status)
    }

    @Test fun showsTheStatusAfterASync() {
        val f = RepoFixture()
        val vm = vm(f)
        val seen = ArrayList<TodayUiState>()
        vm.uiState.onEach { seen.add(it) }.launchIn(kotlinx.coroutines.CoroutineScope(main.dispatcher))
        vm.refresh()
        val deadline = System.currentTimeMillis() + 5_000
        while (vm.uiState.value.status == null && System.currentTimeMillis() < deadline) Thread.sleep(10)
        val s = vm.uiState.value
        assertTrue(s.configured)
        assertEquals(25, s.status!!.remainingMin)
        assertNull(s.error)
        assertEquals(5_000, s.lastSyncMs)
    }

    @Test fun surfacesASyncError() {
        val f = RepoFixture()
        f.api.statusFailure = ApiException(503, "The server had a problem (503).")
        val vm = vm(f)
        vm.uiState.onEach { }.launchIn(kotlinx.coroutines.CoroutineScope(main.dispatcher))
        vm.refresh()
        val deadline = System.currentTimeMillis() + 5_000
        while (vm.uiState.value.error == null && System.currentTimeMillis() < deadline) Thread.sleep(10)
        assertEquals("The server had a problem (503).", vm.uiState.value.error)
    }

    @Test fun wakeReportsTheServersSentence() {
        val vm = vm(RepoFixture())
        vm.wake()
        assertEquals("Up before your goal. +15 XP", nextMessage(vm))
    }

    @Test fun wakeFailureBecomesAReadableMessage() {
        val f = RepoFixture(configured = false)
        val vm = vm(f)
        vm.wake()
        assertEquals("Connect to your server first.", nextMessage(vm))
    }

    @Test fun startAndStopTimerAnnounceThemselves() {
        val f = RepoFixture()
        val vm = vm(f)
        vm.selectTimerKind(TimerKind.GAMING)
        assertEquals(TimerKind.GAMING, f.repository.state.value.timerKind)
        vm.startTimer()
        assertEquals("Gaming timer started", nextMessage(vm))
        vm.stopTimer()
        assertEquals("Timer stopped", nextMessage(vm))
        assertTrue(f.api.calls.contains("start:gaming") && f.api.calls.contains("stop"))
    }

    @Test fun selectingATimerKindIsRememberedByTheRepository() {
        val f = RepoFixture()
        val vm = vm(f)
        vm.selectTimerKind(TimerKind.LUNCH)
        assertEquals(TimerKind.LUNCH, f.prefs.timerKind)
        assertNotNull(vm.uiState)
    }
}
