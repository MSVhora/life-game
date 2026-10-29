package app.lifegame.companion

import app.lifegame.core.repository.LifeGameRepository
import app.lifegame.core.sync.FakeApi
import app.lifegame.core.sync.FakeConnections
import app.lifegame.core.sync.FakePrefs
import app.lifegame.core.sync.FakeQueue
import app.lifegame.core.sync.FakeSyncState
import app.lifegame.core.sync.FakeUsage
import app.lifegame.core.sync.SyncEngine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.rules.TestWatcher
import org.junit.runner.Description

/** A repository wired to in-memory fakes, the same way the app wires the real parts. */
class RepoFixture(configured: Boolean = true) {
    val connections = FakeConnections(if (configured) app.lifegame.core.sync.Connection("https://life.test", "lg_token") else null)
    val api = FakeApi()
    val prefs = FakePrefs()
    val state = FakeSyncState()
    val queue = FakeQueue()
    val usage = FakeUsage()
    val repository = LifeGameRepository(
        connections, SyncEngine(connections, usage, queue, state) { api }, state, queue, prefs, { api },
    ) { 5_000 }
}

/** viewModelScope runs on Dispatchers.Main; tests replace it with a test dispatcher. */
@OptIn(ExperimentalCoroutinesApi::class)
class MainDispatcherRule : TestWatcher() {
    val dispatcher = UnconfinedTestDispatcher()
    override fun starting(description: Description) = Dispatchers.setMain(dispatcher)
    override fun finished(description: Description) = Dispatchers.resetMain()
}
