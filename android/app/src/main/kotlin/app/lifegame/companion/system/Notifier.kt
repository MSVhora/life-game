package app.lifegame.companion.system

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import app.lifegame.companion.R
import app.lifegame.companion.ui.MainActivity
import app.lifegame.core.format.Format
import app.lifegame.core.model.Status
import app.lifegame.core.nudge.Nudge

/** Builds and posts the two notifications: the ongoing countdown and the occasional game-time nudge. */
object Notifier {
    const val TRACKING_ID = 1
    private const val NUDGE_ID = 2
    private const val CH_TRACKING = "tracking"
    private const val CH_NUDGES = "nudges"

    fun ensureChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_TRACKING, "Day countdown", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Shows how long is left today and keeps tracking running."
            setShowBadge(false)
        })
        nm.createNotificationChannel(NotificationChannel(CH_NUDGES, "Game time nudges", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "A short warning when game time is running out."
        })
    }

    private fun openApp(context: Context): PendingIntent = PendingIntent.getActivity(
        context, 0, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /** The system counts down to the deadline by itself, so the notification stays right between updates. */
    fun tracking(context: Context, status: Status?, error: String?, nowMs: Long = System.currentTimeMillis()): Notification {
        val b = Notification.Builder(context, CH_TRACKING)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(if (status?.countsToday == true) "Day ends in" else "Life Game")
            .setContentText(if (error != null && status == null) "Offline: will retry" else Format.summary(status))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(openApp(context))
            .setCategory(Notification.CATEGORY_STATUS)
        if (status != null && status.countsToday && status.endsAtMs > nowMs) {
            b.setWhen(status.endsAtMs).setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(true)
        }
        return b.build()
    }

    fun update(context: Context, status: Status?, error: String?) {
        context.getSystemService(NotificationManager::class.java).notify(TRACKING_ID, tracking(context, status, error))
    }

    fun nudge(context: Context, nudge: Nudge) {
        val n = Notification.Builder(context, CH_NUDGES)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(nudge.title)
            .setContentText(nudge.text)
            .setAutoCancel(true)
            .setContentIntent(openApp(context))
            .setCategory(Notification.CATEGORY_REMINDER)
            .build()
        context.getSystemService(NotificationManager::class.java).notify(NUDGE_ID, n)
    }
}
