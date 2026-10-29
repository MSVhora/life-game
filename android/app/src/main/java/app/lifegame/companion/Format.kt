package app.lifegame.companion

object Format {
    /** 1 h 05 min, 35 min, or "under a minute". */
    fun duration(ms: Long): String {
        val m = ms / 60_000
        return when {
            ms < 60_000 -> "under a minute"
            m < 60 -> "$m min"
            else -> "${m / 60} h ${"%02d".format(m % 60)} min"
        }
    }

    fun summary(s: Status?): String = when {
        s == null -> "Waiting for the server…"
        s.baseline -> "Baseline week: just tracking, nothing counts."
        s.dayStatus == "paused" -> "Day off. Nothing counts today."
        else -> "${s.requiredDone} of ${s.tasksRequired} tasks · ${s.remainingMin} min game time left"
    }
}
