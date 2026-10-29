package app.lifegame.companion

import android.os.Handler
import android.os.Looper
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

private val main = Handler(Looper.getMainLooper())

/** Quick-settings tile: tap once when you wake up. */
class WakeTileService : TileService() {
    override fun onStartListening() {
        val tile = qsTile ?: return
        val prefs = Prefs(this)
        val done = prefs.status()?.wakeToday == true
        tile.state = if (!prefs.configured) Tile.STATE_UNAVAILABLE else if (done) Tile.STATE_INACTIVE else Tile.STATE_ACTIVE
        tile.subtitle = if (!prefs.configured) "Set up first" else if (done) "Logged today" else "Tap when awake"
        tile.updateTile()
    }

    override fun onClick() {
        val prefs = Prefs(this)
        if (!prefs.configured) return
        Thread {
            val msg = try {
                val m = ApiClient(prefs.serverUrl, prefs.token).wake()
                runCatching { SyncEngine.runOnce(this) }
                m
            } catch (e: Exception) {
                "Could not reach the server"
            }
            main.post { qsTile?.let { it.subtitle = msg; it.updateTile() } }
        }.start()
    }
}

/** Quick-settings tile: starts or stops the timer chosen in the app (work by default). */
class TimerTileService : TileService() {
    override fun onStartListening() = refresh(Prefs(this).status())

    private fun refresh(status: Status?) {
        val tile = qsTile ?: return
        val prefs = Prefs(this)
        val running = status?.timerKind
        tile.state = if (!prefs.configured) Tile.STATE_UNAVAILABLE else if (running != null) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        tile.subtitle = if (running != null) "$running running" else "Start ${prefs.timerKind}"
        tile.updateTile()
    }

    override fun onClick() {
        val prefs = Prefs(this)
        if (!prefs.configured) return
        val running = prefs.status()?.timerKind != null
        Thread {
            val api = ApiClient(prefs.serverUrl, prefs.token)
            val status = try {
                if (running) api.stopTimer() else api.startTimer(prefs.timerKind)
                val raw = api.statusRaw()
                prefs.statusJson = raw
                Status.parse(raw)
            } catch (e: Exception) {
                null
            }
            main.post { refresh(status ?: prefs.status()) }
        }.start()
    }
}
