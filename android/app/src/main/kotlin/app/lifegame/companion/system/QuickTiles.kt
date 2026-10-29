package app.lifegame.companion.system

import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import app.lifegame.companion.LifeGameApp
import app.lifegame.core.model.Status
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

private fun TileService.container() = (application as LifeGameApp).container

/** Quick-settings tile: tap once when you wake up. */
class WakeTileService : TileService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun onStartListening() = render(null)

    private fun render(message: String?) {
        val tile = qsTile ?: return
        val state = container().repository.state.value
        val done = state.status?.wakeToday == true
        tile.state = when {
            !state.configured -> Tile.STATE_UNAVAILABLE
            done -> Tile.STATE_INACTIVE
            else -> Tile.STATE_ACTIVE
        }
        tile.subtitle = message ?: when {
            !state.configured -> "Set up first"
            done -> "Logged today"
            else -> "Tap when awake"
        }
        tile.updateTile()
    }

    override fun onClick() {
        if (!container().repository.state.value.configured) return
        scope.launch {
            val r = container().repository.wake()
            render(r.getOrElse { "Could not reach the server" })
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}

/** Quick-settings tile: starts or stops the timer chosen in the app (work by default). */
class TimerTileService : TileService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun onStartListening() = render(container().repository.state.value.status)

    private fun render(status: Status?) {
        val tile = qsTile ?: return
        val state = container().repository.state.value
        val running = status?.timerKind
        tile.state = when {
            !state.configured -> Tile.STATE_UNAVAILABLE
            running != null -> Tile.STATE_ACTIVE
            else -> Tile.STATE_INACTIVE
        }
        tile.subtitle = if (running != null) "$running running" else "Start ${state.timerKind.id}"
        tile.updateTile()
    }

    override fun onClick() {
        val repo = container().repository
        if (!repo.state.value.configured) return
        scope.launch {
            if (repo.state.value.status?.timerKind != null) repo.stopTimer() else repo.startTimer(repo.state.value.timerKind)
            render(repo.state.value.status)
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
