package app.lifegame.core.sync

import app.lifegame.core.model.Status
import app.lifegame.core.net.ApiException

data class SyncResult(
    val collected: Int,
    val uploaded: Int,
    val error: String?,
    val status: Status?,
    val foregroundApp: String?,
)

/**
 * One round: collect usage into the queue, upload the queue, refresh the status.
 * Safe to call from any thread; rounds never overlap.
 */
class SyncEngine(
    private val connections: ConnectionStore,
    private val usage: UsageSource,
    private val queue: EventQueue,
    private val state: SyncStateStore,
    private val apiFactory: ApiFactory,
) {
    private val lock = Any()

    fun runOnce(nowMs: Long): SyncResult = synchronized(lock) {
        val connection = connections.current()
            ?: return SyncResult(0, 0, "Enter the server address and token first.", cachedStatus(), null)
        val api = apiFactory.create(connection)

        var error: String? = null
        var collected = 0
        var uploaded = 0

        try {
            val events = usage.collect(nowMs)
            queue.put(events)
            collected = events.size
        } catch (e: Exception) {
            error = "Reading usage failed: ${e.message}"
        }

        try {
            while (true) {
                val batch = queue.take(BATCH)
                if (batch.isEmpty()) break
                api.postEvents(batch)
                queue.delete(batch.map { it.key }) // only after the server has accepted them
                uploaded += batch.size
            }
        } catch (e: Exception) {
            error = describe(e) // events stay queued and go out next time
        }

        var status = cachedStatus()
        try {
            val raw = api.statusRaw()
            status = Status.parse(raw)
            state.statusJson = raw
        } catch (e: Exception) {
            if (error == null) error = describe(e)
        }

        if (uploaded > 0) state.lastUploaded = uploaded
        if (error == null) state.lastSyncMs = nowMs
        state.lastError = error
        SyncResult(collected, uploaded, error, status, usage.foregroundApp)
    }

    private fun cachedStatus(): Status? = state.statusJson?.let { runCatching { Status.parse(it) }.getOrNull() }

    private fun describe(e: Exception): String = when (e) {
        is ApiException -> e.message ?: "Server error ${e.code}"
        is java.net.UnknownHostException -> "Cannot find the server. Check the address and your connection."
        is java.net.SocketTimeoutException -> "The server took too long to answer."
        is java.net.ConnectException -> "Cannot reach the server."
        else -> e.message ?: e.javaClass.simpleName
    }

    companion object {
        const val BATCH = 300
    }
}
