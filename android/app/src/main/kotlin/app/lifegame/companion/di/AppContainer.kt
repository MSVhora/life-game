package app.lifegame.companion.di

import android.content.Context
import app.lifegame.companion.system.PermissionChecker
import app.lifegame.companion.system.TrackingController
import app.lifegame.core.net.HttpLifeGameApi
import app.lifegame.core.repository.LifeGameRepository
import app.lifegame.core.sync.ApiFactory
import app.lifegame.core.sync.SyncEngine
import app.lifegame.data.queue.SqliteOutbox
import app.lifegame.data.settings.SettingsStore
import app.lifegame.data.usage.UsageStatsSource

/**
 * The object graph, built once. Small enough that a DI framework would only add weight;
 * every dependency is an interface from :core, so tests can swap them.
 */
class AppContainer(context: Context) {
    private val appContext = context.applicationContext

    val settings = SettingsStore(appContext)
    private val outbox = SqliteOutbox(appContext)
    private val usage = UsageStatsSource(appContext, settings)
    private val apiFactory = ApiFactory { HttpLifeGameApi(it.serverUrl, it.token) }
    private val syncEngine = SyncEngine(settings, usage, outbox, settings, apiFactory)

    val repository = LifeGameRepository(settings, syncEngine, settings, outbox, settings, apiFactory)
    val tracking = TrackingController(appContext, repository)
    val permissions = PermissionChecker(appContext)
}
