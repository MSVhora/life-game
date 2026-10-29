package app.lifegame.companion.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import app.lifegame.companion.LifeGameApp
import app.lifegame.companion.ui.navigation.AppNavigation
import app.lifegame.companion.ui.theme.LifeGameTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val container = (application as LifeGameApp).container

        // Used by scripted checks: `am start ... --ez autostart true`.
        if (intent.getBooleanExtra("autostart", false)) container.tracking.start()

        val version = packageManager.getPackageInfo(packageName, 0).versionName ?: ""
        setContent {
            LifeGameTheme {
                AppNavigation(container, version)
            }
        }
    }
}
