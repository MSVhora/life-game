package app.lifegame.companion.system

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import app.lifegame.companion.LifeGameApp
import app.lifegame.core.nudge.Nudger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** Keeps the countdown notification up and syncs once a minute while it runs. */
class TrackingService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var loop: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val container = (application as LifeGameApp).container
        if (intent?.action == ACTION_STOP) {
            container.repository.setTracking(false)
            loop?.cancel()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        Notifier.ensureChannels(this)
        val n = Notifier.tracking(this, container.repository.state.value.status, null)
        if (Build.VERSION.SDK_INT >= 34) startForeground(Notifier.TRACKING_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(Notifier.TRACKING_ID, n)

        container.repository.setTracking(true)
        // The backup job is a bonus: if scheduling fails the service must keep running.
        runCatching { SyncJobService.schedule(this) }

        loop?.cancel()
        loop = scope.launch {
            while (isActive) {
                val result = container.repository.sync()
                Notifier.update(this@TrackingService, result.status, result.error)
                result.status?.let { status ->
                    Nudger.decide(System.currentTimeMillis(), status, result.foregroundApp, container.settings)
                        ?.let { Notifier.nudge(this@TrackingService, it) }
                }
                delay(INTERVAL_MS)
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        scope.cancel()
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
