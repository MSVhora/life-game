package app.lifegame.companion

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.pm.PackageManager

/** Reads the phone's usage events and queues them for upload. */
class Collector(private val context: Context, private val prefs: Prefs, private val outbox: Outbox) {
    private val labelCache = HashMap<String, String>()

    fun hasUsageAccess(): Boolean = Companion.hasUsageAccess(context)

    fun appLabel(pkg: String): String = labelCache.getOrPut(pkg) {
        try {
            val pm = context.packageManager
            pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString().replace(Regex("[\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069\\ufeff]"), "").trim().ifEmpty { pkg }
        } catch (_: PackageManager.NameNotFoundException) {
            pkg
        }
    }

    /** Returns the label of the app in the foreground right now, or null. */
    var foregroundApp: String? = null
        private set

    /** Queues everything since the last run. Returns how many events were queued. */
    fun collect(nowMs: Long): Int {
        if (!hasUsageAccess()) return 0
        val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager

        val checkpoint = prefs.checkpointMs
        val firstRun = checkpoint == 0L
        // Start a little early, and at the start of a session that was still open, so nothing is cut off.
        var from = if (firstRun) nowMs - BACKFILL_MS else checkpoint - OVERLAP_MS
        if (!firstRun && prefs.openPkg != null) from = minOf(from, prefs.openStartMs)
        from = maxOf(from, nowMs - BACKFILL_MS)

        val events = ArrayList<RawEvent>()
        val q = usm.queryEvents(from, nowMs)
        val e = UsageEvents.Event()
        while (q.hasNextEvent()) {
            q.getNextEvent(e)
            events.add(RawEvent(e.timeStamp, e.packageName, e.eventType))
        }

        val built = SessionBuilder.build(events, nowMs, SessionBuilder.IGNORED + context.packageName)
        val out = ArrayList<OutEvent>()
        built.sessions.forEach { out.add(EventMapper.session(it, appLabel(it.pkg))) }
        built.screen.forEach { out.add(EventMapper.screen(it)) }
        outbox.put(out)

        prefs.checkpointMs = nowMs
        prefs.openPkg = built.open?.pkg
        prefs.openStartMs = built.open?.start ?: 0
        foregroundApp = built.open?.let { appLabel(it.pkg) }
        return out.size
    }

    companion object {
        const val OVERLAP_MS = 10 * 60_000L
        const val BACKFILL_MS = 3 * 24 * 3_600_000L

        fun hasUsageAccess(context: Context): Boolean {
            val ops = context.getSystemService(Context.APP_OPS_SERVICE) as android.app.AppOpsManager
            @Suppress("DEPRECATION")
            val mode = ops.checkOpNoThrow(android.app.AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), context.packageName)
            return mode == android.app.AppOpsManager.MODE_ALLOWED
        }
    }
}
