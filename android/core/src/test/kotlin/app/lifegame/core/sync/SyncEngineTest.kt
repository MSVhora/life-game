package app.lifegame.core.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.net.SocketTimeoutException
import java.net.UnknownHostException

class SyncEngineTest {
    private lateinit var connections: FakeConnections
    private lateinit var usage: FakeUsage
    private lateinit var queue: FakeQueue
    private lateinit var state: FakeSyncState
    private lateinit var api: FakeApi
    private lateinit var engine: SyncEngine

    @Before fun setUp() {
        connections = FakeConnections(); usage = FakeUsage(); queue = FakeQueue(); state = FakeSyncState(); api = FakeApi()
        engine = SyncEngine(connections, usage, queue, state) { api }
    }

    @Test fun doesNothingUntilTheServerIsConfigured() {
        connections.connection = null
        val r = engine.runOnce(1000)
        assertEquals("Enter the server address and token first.", r.error)
        assertEquals(0, usage.calls); assertTrue(api.calls.isEmpty())
    }

    @Test fun collectsUploadsAndRefreshesTheStatus() {
        usage.events = events(3); usage.foregroundApp = "Chess"
        val r = engine.runOnce(5000)
        assertEquals(3, r.collected); assertEquals(3, r.uploaded); assertNull(r.error)
        assertEquals("Chess", r.foregroundApp)
        assertEquals(25, r.status!!.remainingMin)
        assertEquals(0, queue.count())
        assertEquals(5000, state.lastSyncMs); assertEquals(3, state.lastUploaded); assertNull(state.lastError)
        assertNotNull(state.statusJson)
    }

    @Test fun uploadsInBatches() {
        usage.events = events(650)
        engine.runOnce(1)
        assertEquals(listOf(300, 300, 50), api.posted.map { it.size })
    }

    @Test fun keepsEventsQueuedWhenTheUploadFails() {
        usage.events = events(5)
        api.postFailure = java.io.IOException("boom")
        val r = engine.runOnce(1000)
        assertEquals("boom", r.error); assertEquals(0, r.uploaded)
        assertEquals(5, queue.count())
        assertEquals(0, state.lastSyncMs) // a failed round is not a sync
        assertEquals("boom", state.lastError)

        api.postFailure = null
        val again = engine.runOnce(2000)
        assertEquals(5, again.uploaded); assertNull(again.error); assertEquals(0, queue.count())
        assertEquals(2000, state.lastSyncMs); assertNull(state.lastError)
    }

    @Test fun anAlreadyQueuedSessionIsReplacedNotDuplicated() {
        usage.events = listOf(app.lifegame.core.model.OutEvent("p:1", "{\"d\":60}"))
        api.postFailure = java.io.IOException("offline")
        engine.runOnce(1)
        usage.events = listOf(app.lifegame.core.model.OutEvent("p:1", "{\"d\":900}"))
        engine.runOnce(2)
        assertEquals(1, queue.count())
        assertEquals("{\"d\":900}", queue.items["p:1"]!!.json)
    }

    @Test fun explainsARefusedToken() {
        usage.events = events(1)
        api.postFailure = unauthorized
        assertTrue(engine.runOnce(1).error!!.contains("token"))
        assertEquals(1, queue.count())
    }

    @Test fun translatesNetworkFailures() {
        queue.put(events(1)) // something must be waiting, otherwise nothing is sent
        api.postFailure = UnknownHostException("x")
        assertTrue(engine.runOnce(1).error!!.contains("Cannot find the server"))
        api.postFailure = SocketTimeoutException("x")
        assertTrue(engine.runOnce(2).error!!.contains("too long"))
        api.postFailure = java.net.ConnectException("x")
        assertTrue(engine.runOnce(3).error!!.contains("Cannot reach"))
    }

    @Test fun aFailureReadingUsageStillUploadsWhatWasQueued() {
        queue.put(events(2))
        usage.failWith = IllegalStateException("denied")
        val r = engine.runOnce(1)
        assertEquals("Reading usage failed: denied", r.error)
        assertEquals(2, r.uploaded); assertEquals(0, queue.count())
    }

    @Test fun keepsTheOldStatusWhenTheStatusCallFails() {
        engine.runOnce(1) // caches a status
        api.statusFailure = java.io.IOException("down")
        val r = engine.runOnce(2)
        assertEquals("down", r.error)
        assertEquals(25, r.status!!.remainingMin)
        assertEquals(1, state.lastSyncMs)
    }

    @Test fun ignoresAnUnreadableCachedStatus() {
        state.statusJson = "not json"
        api.statusFailure = java.io.IOException("down")
        assertNull(engine.runOnce(1).status)
    }
}
