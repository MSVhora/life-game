package app.lifegame.companion

import android.app.Application
import app.lifegame.companion.di.AppContainer

class LifeGameApp : Application() {
    /** Manual dependency injection: one place builds the object graph (see di/AppContainer). */
    val container: AppContainer by lazy { AppContainer(this) }
}
