package app.lifegame.companion.ui.setup

import app.lifegame.companion.MainDispatcherRule
import app.lifegame.companion.RepoFixture
import app.lifegame.companion.system.PermissionSource
import app.lifegame.companion.system.PermissionState
import app.lifegame.companion.system.TrackingSwitch
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SetupViewModelTest {
    @get:Rule val main = MainDispatcherRule()

    private class FakePermissions(var state: PermissionState) : PermissionSource { override fun check() = state }
    private class FakeTracking(var failWith: String? = null) : TrackingSwitch {
        var started = 0; var stopped = 0
        override fun start(): String? { started++; return failWith }
        override fun stop() { stopped++ }
    }

    private val none = PermissionState(usageAccess = false, notifications = false, batteryUnrestricted = false)
    private val all = PermissionState(usageAccess = true, notifications = true, batteryUnrestricted = true)

    private fun vm(f: RepoFixture, p: FakePermissions = FakePermissions(none), t: FakeTracking = FakeTracking()): SetupViewModel =
        SetupViewModel(f.repository, p, t, "0.2.0").also { it.uiState.onEach { }.launchIn(kotlinx.coroutines.CoroutineScope(main.dispatcher)) }

    private fun waitFor(cond: () -> Boolean) {
        val deadline = System.currentTimeMillis() + 5_000
        while (!cond() && System.currentTimeMillis() < deadline) Thread.sleep(10)
        assertTrue("condition not met in time", cond())
    }

    @Test fun prefillsTheSavedAddress() {
        val f = RepoFixture()
        val vm = vm(f)
        assertEquals("https://life.test", vm.uiState.value.urlDraft)
        assertTrue(vm.uiState.value.tokenSaved)
        assertEquals("0.2.0", vm.uiState.value.versionName)
    }

    @Test fun editingTheFormClearsAnOldResult() {
        val vm = vm(RepoFixture())
        vm.saveAndTest(); waitFor { vm.uiState.value.connectionResult != null }
        vm.onUrlChange("https://other.example")
        assertNull(vm.uiState.value.connectionResult)
        assertEquals("https://other.example", vm.uiState.value.urlDraft)
    }

    @Test fun savingAndTestingSucceedsAndClearsTheTokenField() {
        val f = RepoFixture(configured = false)
        val vm = vm(f)
        vm.onUrlChange("https://life.test"); vm.onTokenChange("lg_new")
        vm.saveAndTest()
        waitFor { vm.uiState.value.connectionResult != null }
        val r = vm.uiState.value.connectionResult as ConnectionResult.Success
        assertEquals("Connected. 1 of 2 tasks · 25 min game time left", r.summary)
        assertEquals("", vm.uiState.value.tokenDraft)
        assertFalse(vm.uiState.value.saving)
        assertEquals("lg_new", f.connections.current()!!.token)
    }

    @Test fun aFailedTestKeepsWhatWasTypedAndSaysWhy() {
        val f = RepoFixture()
        f.api.statusFailure = java.io.IOException("Cannot reach the server.")
        val vm = vm(f)
        vm.onTokenChange("lg_typed")
        vm.saveAndTest()
        waitFor { vm.uiState.value.connectionResult != null }
        assertEquals("Cannot reach the server.", (vm.uiState.value.connectionResult as ConnectionResult.Failure).reason)
        assertEquals("lg_typed", vm.uiState.value.tokenDraft)
    }

    @Test fun anEmptyAddressIsRefused() {
        val vm = vm(RepoFixture(configured = false))
        vm.saveAndTest()
        waitFor { vm.uiState.value.connectionResult != null }
        assertEquals("Enter the server address.", (vm.uiState.value.connectionResult as ConnectionResult.Failure).reason)
    }

    @Test fun permissionsAreReReadWhenAsked() {
        val perms = FakePermissions(none)
        val vm = vm(RepoFixture(), perms)
        assertFalse(vm.uiState.value.permissions.usageAccess)
        perms.state = all
        vm.refreshPermissions()
        assertTrue(vm.uiState.value.permissions.essentialsGranted)
    }

    @Test fun switchingTrackingOnAndOff() {
        val f = RepoFixture(); val t = FakeTracking()
        val vm = vm(f, t = t)
        assertNull(vm.setTracking(true))
        assertEquals(1, t.started); assertTrue(f.prefs.trackingWanted)
        assertNull(vm.setTracking(false))
        assertEquals(1, t.stopped)
    }

    @Test fun aFailedStartIsReportedAndTrackingStaysOff() {
        val f = RepoFixture(); val t = FakeTracking(failWith = "Could not start tracking: denied")
        val vm = vm(f, t = t)
        assertEquals("Could not start tracking: denied", vm.setTracking(true))
        assertFalse(f.prefs.trackingWanted)
    }

    @Test fun syncNowRunsASync() {
        val f = RepoFixture()
        val vm = vm(f)
        vm.syncNow()
        waitFor { f.api.calls.contains("status") }
        waitFor { vm.uiState.value.lastSyncMs == 5_000L }
    }
}
