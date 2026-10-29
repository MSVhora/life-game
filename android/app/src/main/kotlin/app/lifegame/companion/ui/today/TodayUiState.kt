package app.lifegame.companion.ui.today

import app.lifegame.core.model.Status
import app.lifegame.core.model.TimerKind
import app.lifegame.core.repository.AppState

/** Everything the Today screen draws. The screen holds no other state. */
data class TodayUiState(
    val configured: Boolean = false,
    val status: Status? = null,
    val syncing: Boolean = false,
    val error: String? = null,
    val lastSyncMs: Long = 0,
    val queued: Int = 0,
    val timerKind: TimerKind = TimerKind.WORK,
) {
    companion object {
        fun from(s: AppState) = TodayUiState(
            configured = s.configured, status = s.status, syncing = s.syncing, error = s.lastError,
            lastSyncMs = s.lastSyncMs, queued = s.queued, timerKind = s.timerKind,
        )
    }
}
