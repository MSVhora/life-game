package app.lifegame.core.repository

import app.lifegame.core.model.TimerKind
import app.lifegame.core.sync.FakeApi
import app.lifegame.core.sync.FakeConnections
import app.lifegame.core.sync.FakePrefs
import app.lifegame.core.sync.FakeQueue
import app.lifegame.core.sync.FakeSyncState
import app.lifegame.core.sync.FakeUsage
import app.lifegame.core.sync.SyncEngine
import app.lifegame.core.sync.events
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class LifeGameRepositoryTest {
    private lateinit var connections: FakeConnections
    private lateinit var queue: FakeQueue
    private lateinit var state: FakeSyncState
    private lateinit var prefs: FakePrefs
    private lateinit var api: FakeApi
    private lateinit var usage: FakeUsage
    private lateinit var repo: LifeGameRepository

    @Before fun setUp() {
        connections = FakeConnections(); queue = FakeQueue(); state = FakeSyncState(); prefs = FakePrefs(); api = FakeApi(); usage = FakeUsage()
        build()
    }

    private fun build() {
        val engine = SyncEngine(connections, usage, queue, state) { api }
        repo = LifeGameRepository(connections, engine, state, queue, prefs, { api }) { 9_000 }
    }

    @Test fun startsFromWhatIsStored() {
        connections.connection = null
        state.statusJson = null
        build()
        val s = repo.state.value
        assertFalse(s.configured); assertNull(s.status); assertEquals(0, s.queued); assertEquals(TimerKind.WORK, s.timerKind)
    }

    @Test fun syncPublishesTheNewState() = runBlocking {
        usage.events = events(2)
        api.postFailure = java.io.IOException("offline")
        repo.sync()
        assertEquals("offline", repo.state.value.lastError)
        assertEquals(2, repo.state.value.queued)
        assertFalse(repo.state.value.syncing)

        api.postFailure = null
        repo.sync()
        val s = repo.state.value
        assertNull(s.lastError); assertEquals(0, s.queued); assertEquals(9_000, s.lastSyncMs)
        assertEquals(25, s.status!!.remainingMin)
    }

    @Test fun actionsRefreshTheStatus() = runBlocking {
        val r = repo.wake()
        assertEquals("Up before your goal. +15 XP", r.getOrThrow())
        assertTrue(api.calls.containsAll(listOf("wake", "status")))
        assertNotNull(repo.state.value.status)
    }

    @Test fun startsAndStopsTimersAndRemembersTheKind() = runBlocking {
        assertTrue(repo.startTimer(TimerKind.GAMING).isSuccess)
        assertEquals(TimerKind.GAMING, repo.state.value.timerKind)
        assertTrue(repo.stopTimer().isSuccess)
        assertTrue(api.calls.contains("start:gaming")); assertTrue(api.calls.contains("stop"))
    }

    @Test fun actionsFailClearlyWhenNotConnected() = runBlocking {
        connections.connection = null
        build()
        assertEquals("Connect to your server first.", repo.wake().exceptionOrNull()!!.message)
        assertTrue(api.calls.isEmpty())
    }

    @Test fun anActionThatFailsDoesNotRefreshAndReportsTheError() = runBlocking {
        val failing = object : app.lifegame.core.net.LifeGameApi by api {
            override fun wake(): String = throw app.lifegame.core.net.ApiException(409, "That day has ended")
        }
        val engine = SyncEngine(connections, usage, queue, state) { api }
        val r2 = LifeGameRepository(connections, engine, state, queue, prefs, { failing }) { 1 }
        assertEquals("That day has ended", r2.wake().exceptionOrNull()!!.message)
        assertFalse(api.calls.contains("status"))
    }

    @Test fun savingTheConnectionKeepsTheTokenWhenNoneIsGiven() = runBlocking {
        val r = repo.saveConnection("https://new.example", null)
        assertTrue(r.isSuccess)
        assertEquals("https://new.example", connections.current()!!.serverUrl)
        assertEquals("lg_token", connections.current()!!.token)
        assertNotNull(repo.state.value.status)
    }

    @Test fun savingAnEmptyAddressIsRefused() = runBlocking {
        assertEquals("Enter the server address.", repo.saveConnection("  ", "x").exceptionOrNull()!!.message)
    }

    @Test fun savingWithoutAnyTokenAsksForOne() = runBlocking {
        connections.connection = null
        build()
        assertEquals("Enter the device token.", repo.saveConnection("https://x.example", null).exceptionOrNull()!!.message)
    }

    @Test fun savedButUnreachableStillKeepsTheSettingsAndReportsFailure() = runBlocking {
        api.statusFailure = java.io.IOException("no route")
        val r = repo.saveConnection("https://x.example", "lg_new")
        assertTrue(r.isFailure)
        assertEquals("lg_new", connections.current()!!.token)
    }

    @Test fun trackingPreferenceIsPublished() {
        repo.setTracking(true)
        assertTrue(repo.state.value.trackingWanted); assertTrue(prefs.trackingWanted)
    }
}
