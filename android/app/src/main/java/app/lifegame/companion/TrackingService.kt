package app.lifegame.companion

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import java.util.concurrent.Executors

/** Keeps the countdown notification up and syncs once a minute while it runs. */
class TrackingService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private val tick = object : Runnable {
        override fun run() {
            worker.execute { syncAndShow() }
            handler.postDelayed(this, INTERVAL_MS)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            Prefs(this).trackingWanted = false
            handler.removeCallbacks(tick)
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        Notifier.ensureChannels(this)
        val n = Notifier.tracking(this, Prefs(this).status(), null)
        if (Build.VERSION.SDK_INT >= 34) startForeground(Notifier.TRACKING_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(Notifier.TRACKING_ID, n)
        Prefs(this).trackingWanted = true
        // The backup job is a bonus: if scheduling fails the service must keep running.
        runCatching { SyncJobService.schedule(this) }
        handler.removeCallbacks(tick)
        handler.post(tick)
        return START_STICKY
    }

    private fun syncAndShow() {
        val prefs = Prefs(this)
        val r = SyncEngine.runOnce(this)
        Notifier.update(this, r.status, r.error)
        val status = r.status ?: return
        val state = NudgeState(prefs.nudgeLowDay, prefs.nudgeOverAt)
        Nudger.decide(System.currentTimeMillis(), status, r.foregroundApp, state)?.let { Notifier.nudge(this, it) }
        prefs.nudgeLowDay = state.lowFiredForDay
        prefs.nudgeOverAt = state.lastOverAtMs
    }

    override fun onDestroy() {
        handler.removeCallbacks(tick)
        worker.shutdown()
        super.onDestroy()
    }

    companion object {
        const val ACTION_STOP = "app.lifegame.companion.STOP"
        private const val INTERVAL_MS = 60_000L

        fun start(context: Context) {
            context.startForegroundService(Intent(context, TrackingService::class.java))
        }

        fun stop(context: Context) {
            context.startService(Intent(context, TrackingService::class.java).setAction(ACTION_STOP))
        }
    }
}
