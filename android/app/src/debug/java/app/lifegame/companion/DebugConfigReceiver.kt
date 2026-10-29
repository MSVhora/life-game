package app.lifegame.companion

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Debug builds only. adb shell am broadcast -n app.lifegame.companion/.DebugConfigReceiver --es url ... --es token ... */
class DebugConfigReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val prefs = Prefs(context)
        intent.getStringExtra("url")?.let { prefs.serverUrl = it }
        intent.getStringExtra("token")?.let { prefs.token = it }
        resultData = "configured=${prefs.configured}"
    }
}
