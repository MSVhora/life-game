package app.lifegame.companion

import android.content.Context

data class SyncResult(val collected: Int, val uploaded: Int, val error: String?, val status: Status?, val foregroundApp: String?)

/** One round: collect usage, upload what is queued, refresh the status. Safe to call from any background thread. */
object SyncEngine {
    private val lock = Any()
    private const val BATCH = 300

    fun runOnce(context: Context, nowMs: Long = System.currentTimeMillis()): SyncResult = synchronized(lock) {
        val prefs = Prefs(context)
        if (!prefs.configured) return SyncResult(0, 0, "Enter the server address and token first.", null, null)
        val outbox = Outbox(context)
        val collector = Collector(context, prefs, outbox)
        val api = ApiClient(prefs.serverUrl, prefs.token)

        var error: String? = null
        var uploaded = 0
        var collected = 0
        try {
            collected = collector.collect(nowMs)
        } catch (e: Exception) {
            error = "Reading usage failed: ${e.message}"
        }

        try {
            while (true) {
                val batch = outbox.take(BATCH)
                if (batch.isEmpty()) break
                api.postEvents(batch)
                outbox.delete(batch.map { it.key })
                uploaded += batch.size
            }
        } catch (e: Exception) {
            error = e.message ?: e.javaClass.simpleName // events stay queued and go out next time
        }

        var status: Status? = prefs.status()
        try {
            val raw = api.statusRaw()
            status = Status.parse(raw)
            prefs.statusJson = raw
        } catch (e: Exception) {
            if (error == null) error = e.message
        }

        if (uploaded > 0) prefs.lastUploaded = uploaded
        if (error == null) prefs.lastSyncMs = nowMs
        prefs.lastError = error
        SyncResult(collected, uploaded, error, status, collector.foregroundApp)
    }
}
