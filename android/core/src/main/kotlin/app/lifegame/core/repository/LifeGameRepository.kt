package app.lifegame.core.repository

import app.lifegame.core.model.Status
import app.lifegame.core.model.TimerKind
import app.lifegame.core.sync.ApiFactory
import app.lifegame.core.sync.ConnectionStore
import app.lifegame.core.sync.EventQueue
import app.lifegame.core.sync.PlayerPreferences
import app.lifegame.core.sync.SyncEngine
import app.lifegame.core.sync.SyncResult
import app.lifegame.core.sync.SyncStateStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext

/** Everything the screens, the service and the tiles need to know about the app, in one value. */
data class AppState(
    val configured: Boolean,
    val serverUrl: String,
    val status: Status?,
    val lastSyncMs: Long,
    val lastError: String?,
    val lastUploaded: Int,
    val queued: Int,
    val syncing: Boolean,
    val trackingWanted: Boolean,
    val timerKind: TimerKind,
)

/**
 * Single source of truth. Screens observe [state]; every action goes through here,
 * so the notification, the tiles and the UI always agree.
 */
class LifeGameRepository(
    private val connections: ConnectionStore,
    private val engine: SyncEngine,
    private val syncState: SyncStateStore,
    private val queue: EventQueue,
    private val prefs: PlayerPreferences,
    private val apiFactory: ApiFactory,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val _state = MutableStateFlow(snapshot(syncing = false))
    val state: StateFlow<AppState> = _state.asStateFlow()

    /** Re-reads the stores (after something changed outside the repository). */
    fun refresh() {
        _state.value = snapshot(_state.value.syncing)
    }

    suspend fun sync(): SyncResult = withContext(Dispatchers.IO) {
        _state.value = snapshot(syncing = true)
        try {
            engine.runOnce(clock())
        } finally {
            _state.value = snapshot(syncing = false)
        }
    }

    suspend fun wake(): Result<String> = act { it.wake() }

    suspend fun startTimer(kind: TimerKind): Result<Unit> {
        prefs.timerKind = kind
        refresh()
        return act { it.startTimer(kind) }
    }

    suspend fun stopTimer(): Result<Unit> = act { it.stopTimer() }

    /** Saves the address (and token if given), then checks that the server answers. Always saves, even when offline. */
    suspend fun saveConnection(serverUrl: String, token: String?): Result<Status> = withContext(Dispatchers.IO) {
        if (serverUrl.isBlank()) return@withContext Result.failure(IllegalArgumentException("Enter the server address."))
        connections.save(serverUrl, token)
        refresh()
        val connection = connections.current()
            ?: return@withContext Result.failure(IllegalArgumentException("Enter the device token."))
        runCatching {
            val raw = apiFactory.create(connection).statusRaw()
            syncState.statusJson = raw
            syncState.lastError = null
            Status.parse(raw)
        }.also { refresh() }
    }

    fun setTracking(wanted: Boolean) {
        prefs.trackingWanted = wanted
        refresh()
    }

    fun setTimerKind(kind: TimerKind) {
        prefs.timerKind = kind
        refresh()
    }

    /** Runs a server action, then refreshes the cached status so every screen shows the new state. */
    private suspend fun <T> act(block: (app.lifegame.core.net.LifeGameApi) -> T): Result<T> = withContext(Dispatchers.IO) {
        val connection = connections.current()
            ?: return@withContext Result.failure(IllegalStateException("Connect to your server first."))
        val result = runCatching { block(apiFactory.create(connection)) }
        if (result.isSuccess) runCatching { engine.runOnce(clock()) }
        refresh()
        result
    }

    private fun snapshot(syncing: Boolean) = AppState(
        configured = connections.current() != null,
        serverUrl = connections.serverUrl,
        status = syncState.statusJson?.let { runCatching { Status.parse(it) }.getOrNull() },
        lastSyncMs = syncState.lastSyncMs,
        lastError = syncState.lastError,
        lastUploaded = syncState.lastUploaded,
        queued = queue.count(),
        syncing = syncing,
        trackingWanted = prefs.trackingWanted,
        timerKind = prefs.timerKind,
    )
}
