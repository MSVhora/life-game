package app.lifegame.companion.system

import android.content.Context
import app.lifegame.core.repository.LifeGameRepository

/** What the UI calls to switch tracking on or off, without knowing about services. */
interface TrackingSwitch {
    /** Returns an error message, or null when tracking started. */
    fun start(): String?
    fun stop()
}

class TrackingController(private val context: Context, private val repository: LifeGameRepository) : TrackingSwitch {
    override fun start(): String? {
        if (!repository.state.value.configured) return "Connect to your server first."
        return runCatching { TrackingService.start(context) }.exceptionOrNull()?.let { "Could not start tracking: ${it.message}" }
    }

    override fun stop() {
        TrackingService.stop(context)
        repository.setTracking(false)
    }
}
