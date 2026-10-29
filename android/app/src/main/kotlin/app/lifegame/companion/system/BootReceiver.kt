package app.lifegame.companion.system

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import app.lifegame.companion.LifeGameApp

/** Resumes tracking after a restart or an app update, if the player had it switched on. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val state = (context.applicationContext as LifeGameApp).container.repository.state.value
        if (!state.configured || !state.trackingWanted) return
        runCatching { SyncJobService.schedule(context) }
        runCatching { TrackingService.start(context) }
    }
}
