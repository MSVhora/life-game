package app.lifegame.core.usage

/** UsageEvents.Event type codes (stable since API 21/29); kept as numbers so this file needs no Android classes. */
object EventType {
    const val ACTIVITY_RESUMED = 1
    const val ACTIVITY_PAUSED = 2
    const val SCREEN_INTERACTIVE = 15
    const val SCREEN_NON_INTERACTIVE = 16
    const val KEYGUARD_SHOWN = 17
    const val KEYGUARD_HIDDEN = 18
    const val DEVICE_SHUTDOWN = 26
}

data class RawEvent(val ts: Long, val pkg: String?, val type: Int)

data class Session(val pkg: String, val start: Long, val end: Long, val ongoing: Boolean) {
    val seconds: Double get() = (end - start) / 1000.0
}

data class ScreenEvent(val kind: String, val ts: Long)

data class OpenSession(val pkg: String, val start: Long)

data class Built(val sessions: List<Session>, val screen: List<ScreenEvent>, val open: OpenSession?)

/** Turns the phone's raw usage events into foreground app sessions and screen events. */
object SessionBuilder {
    /** Packages that are part of the system UI, not something the player did. */
    val IGNORED = setOf("com.android.systemui", "android")

    private const val MERGE_GAP_MS = 3_000L
    private const val MIN_SESSION_MS = 1_000L

    fun build(events: List<RawEvent>, windowEnd: Long, ignored: Set<String> = IGNORED): Built {
        val sorted = events.sortedBy { it.ts }
        val raw = ArrayList<Session>()
        val screen = ArrayList<ScreenEvent>()
        var cur: OpenSession? = null

        fun close(at: Long) {
            val c = cur ?: return
            if (at > c.start) raw.add(Session(c.pkg, c.start, at, false))
            cur = null
        }

        for (e in sorted) {
            when (e.type) {
                EventType.ACTIVITY_RESUMED -> {
                    val p = e.pkg ?: continue
                    if (p in ignored) { close(e.ts); continue }
                    val c = cur
                    if (c == null) cur = OpenSession(p, e.ts)
                    else if (c.pkg != p) { close(e.ts); cur = OpenSession(p, e.ts) }
                }
                EventType.ACTIVITY_PAUSED -> if (cur?.pkg == e.pkg) close(e.ts)
                EventType.SCREEN_NON_INTERACTIVE -> { close(e.ts); screen.add(ScreenEvent("screen_off", e.ts)) }
                EventType.DEVICE_SHUTDOWN -> close(e.ts)
                EventType.SCREEN_INTERACTIVE -> screen.add(ScreenEvent("screen_on", e.ts))
                EventType.KEYGUARD_HIDDEN -> screen.add(ScreenEvent("unlock", e.ts))
            }
        }

        val open = cur
        val all = ArrayList(raw)
        if (open != null && windowEnd > open.start) all.add(Session(open.pkg, open.start, windowEnd, true))

        // Moving between screens of one app produces pause+resume pairs: join sessions that nearly touch.
        val merged = ArrayList<Session>()
        for (s in all.sortedBy { it.start }) {
            val last = merged.lastOrNull()
            if (last != null && last.pkg == s.pkg && s.start - last.end <= MERGE_GAP_MS) {
                merged[merged.size - 1] = Session(last.pkg, last.start, maxOf(last.end, s.end), s.ongoing)
            } else merged.add(s)
        }
        return Built(merged.filter { it.end - it.start >= MIN_SESSION_MS }, screen, open)
    }
}
