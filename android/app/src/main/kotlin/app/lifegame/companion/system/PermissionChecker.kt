package app.lifegame.companion.system

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import app.lifegame.data.usage.UsageAccess

data class PermissionState(val usageAccess: Boolean, val notifications: Boolean, val batteryUnrestricted: Boolean) {
    val essentialsGranted: Boolean get() = usageAccess && notifications
}

/** The permissions the app cares about. An interface so view models can be tested without Android. */
interface PermissionSource {
    fun check(): PermissionState
}

/** Reads the permissions from the system and builds the Settings intents to change them. */
class PermissionChecker(private val context: Context) : PermissionSource {
    override fun check(): PermissionState = PermissionState(
        usageAccess = UsageAccess.isGranted(context),
        notifications = Build.VERSION.SDK_INT < 33 ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED,
        batteryUnrestricted = context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName),
    )

    fun usageAccessIntent(): Intent =
        Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    fun batteryIntent(): Intent =
        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
}
