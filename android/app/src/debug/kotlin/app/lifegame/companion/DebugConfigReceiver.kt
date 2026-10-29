package app.lifegame.companion

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Debug builds only. adb shell am broadcast -n app.lifegame.companion/.DebugConfigReceiver --es url ... --es token ... */
class DebugConfigReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val container = (context.applicationContext as LifeGameApp).container
        val url = intent.getStringExtra("url") ?: container.settings.serverUrl
        container.settings.save(url, intent.getStringExtra("token"))
        container.repository.refresh()
        resultData = "configured=${container.settings.current() != null}"
    }
}
