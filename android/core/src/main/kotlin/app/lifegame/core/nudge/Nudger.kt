package app.lifegame.core.nudge

import app.lifegame.core.model.Status

enum class NudgeKind { LOW, OVER }

data class Nudge(val kind: NudgeKind, val title: String, val text: String)

/** What the nudger remembers between checks. */
data class NudgeState(var lowFiredForDay: Long = -1, var lastOverAtMs: Long = 0)

/** Where that memory is kept between runs of the service. */
interface NudgeMemory {
    var lowFiredForDay: Long
    var lastOverAtMs: Long
}

/**
 * Decides whether to warn about game time. It only speaks while a game app is in the foreground,
 * never on a day that does not count, and never when the player chose "just show data".
 */
object Nudger {
    const val LOW_AT_MIN = 5
    const val OVER_COOLDOWN_MS = 10 * 60_000L

    /** Same as [decide], but loads and saves the memory around the decision. */
    fun decide(nowMs: Long, status: Status, foregroundApp: String?, memory: NudgeMemory): Nudge? {
        val state = NudgeState(memory.lowFiredForDay, memory.lastOverAtMs)
        val nudge = decide(nowMs, status, foregroundApp, state)
        memory.lowFiredForDay = state.lowFiredForDay
        memory.lastOverAtMs = state.lastOverAtMs
        return nudge
    }

    fun decide(nowMs: Long, status: Status, foregroundApp: String?, state: NudgeState): Nudge? {
        if (!status.countsToday || status.pressure == "data_only") return null
        if (foregroundApp == null || foregroundApp !in status.gamingApps) return null

        if (status.remainingMin <= 0 && status.usedMin >= status.earnedMin) {
            if (nowMs - state.lastOverAtMs < OVER_COOLDOWN_MS) return null
            state.lastOverAtMs = nowMs
            val over = status.usedMin - status.earnedMin
            if (over <= 0) return Nudge(NudgeKind.OVER, "No game time left", "Finish a task to earn some.")
            val tail = if (status.pressure == "gentle") "Your call." else "Tomorrow's game time depends on today's tasks."
            return Nudge(NudgeKind.OVER, "Game time is used up", "You are $over min past what you earned. $tail")
        }
        if (status.remainingMin in 1..LOW_AT_MIN && state.lowFiredForDay != status.dayId) {
            state.lowFiredForDay = status.dayId
            return Nudge(NudgeKind.LOW, "${status.remainingMin} min of game time left", "Finish a task to earn more.")
        }
        return null
    }
}
