package app.lifegame.companion

import java.time.Instant

/** What the server tells the phone about today. Parsed from /api/device/status. */
data class Status(
    val dayId: Long,
    val dayStatus: String,
    val endsAtMs: Long,
    val tasksRequired: Int,
    val requiredDone: Int,
    val earnedMin: Int,
    val usedMin: Int,
    val remainingMin: Int,
    val capMin: Int,
    val wakeToday: Boolean,
    val wakeGoal: String,
    val timerKind: String?,
    val timerStartedAtMs: Long?,
    val baseline: Boolean,
    val pressure: String,
    val gamingApps: Set<String>,
) {
    /** Tasks count, so the countdown means something. */
    val countsToday: Boolean get() = dayStatus == "open" && !baseline

    companion object {
        fun parse(json: String): Status {
            val root = Json.parse(json).asMap() ?: throw IllegalArgumentException("Status is not an object")
            val day = root["day"].asMap() ?: throw IllegalArgumentException("Status has no day")
            val budget = root["budget"].asMap() ?: emptyMap()
            val wake = root["wake"].asMap() ?: emptyMap()
            val timer = root["timer"].asMap()
            fun int(m: Map<String, Any?>, k: String) = (m[k] as? Double)?.toInt() ?: 0
            return Status(
                dayId = (day["id"] as? Double)?.toLong() ?: 0,
                dayStatus = day["status"] as? String ?: "open",
                endsAtMs = Instant.parse(day["endsAt"] as String).toEpochMilli(),
                tasksRequired = int(day, "tasksRequired"),
                requiredDone = int(day, "requiredDone"),
                earnedMin = int(budget, "earnedMinutes"),
                usedMin = int(budget, "usedMinutes"),
                remainingMin = int(budget, "remainingMinutes"),
                capMin = int(budget, "capMinutes"),
                wakeToday = wake["today"] != null,
                wakeGoal = wake["goal"] as? String ?: "",
                timerKind = timer?.get("kind") as? String,
                timerStartedAtMs = (timer?.get("startedAt") as? String)?.let { Instant.parse(it).toEpochMilli() },
                baseline = root["baseline"] as? Boolean ?: false,
                pressure = root["pressure"] as? String ?: "gradual",
                gamingApps = root["gamingApps"].asList().orEmpty().filterIsInstance<String>().toSet(),
            )
        }
    }
}
