package app.lifegame.companion

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Resumes tracking after a restart or an app update, if the player had it switched on. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val prefs = Prefs(context)
        if (!prefs.configured || !prefs.trackingWanted) return
        runCatching { SyncJobService.schedule(context) }
        runCatching { TrackingService.start(context) }
    }
}
