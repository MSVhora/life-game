package app.lifegame.core.format

import app.lifegame.core.model.Status

object Format {
    /** "1 h 05 min", "35 min", or "under a minute". */
    fun duration(ms: Long): String {
        val m = ms / 60_000
        return when {
            ms < 60_000 -> "under a minute"
            m < 60 -> "$m min"
            else -> "${m / 60} h ${"%02d".format(m % 60)} min"
        }
    }

    /** "H:MM:SS" for a live countdown. Never negative. */
    fun clock(ms: Long): String {
        val s = (ms.coerceAtLeast(0)) / 1000
        return "%d:%02d:%02d".format(s / 3600, (s % 3600) / 60, s % 60)
    }

    /** One-line state of the day, used by the notification and the tiles. */
    fun summary(s: Status?): String = when {
        s == null -> "Waiting for the server…"
        s.baseline -> "Baseline week: just tracking, nothing counts."
        s.dayStatus == "paused" -> "Day off. Nothing counts today."
        else -> "${s.requiredDone} of ${s.tasksRequired} tasks · ${s.remainingMin} min game time left"
    }
}
