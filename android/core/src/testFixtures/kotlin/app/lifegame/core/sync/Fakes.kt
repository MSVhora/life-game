package app.lifegame.core.sync

import app.lifegame.core.model.OutEvent
import app.lifegame.core.model.Status
import app.lifegame.core.model.TimerKind
import app.lifegame.core.net.ApiException
import app.lifegame.core.net.LifeGameApi

/** In-memory stand-ins for the ports, shared by the sync and repository tests. */
class FakeConnections(var connection: Connection? = Connection("https://life.test", "lg_token")) : ConnectionStore {
    var saved: Pair<String, String?>? = null
    override val serverUrl: String get() = connection?.serverUrl ?: saved?.first ?: ""
    override fun current() = connection
    override fun save(serverUrl: String, token: String?) {
        saved = serverUrl to token
        connection = Connection(serverUrl, if (token.isNullOrBlank()) connection?.token ?: "" else token).takeIf { it.token.isNotBlank() }
    }
}

class FakeUsage(var events: List<OutEvent> = emptyList(), override var hasAccess: Boolean = true) : UsageSource {
    var failWith: Exception? = null
    var calls = 0
    override var foregroundApp: String? = null
    override fun collect(nowMs: Long): List<OutEvent> {
        calls++
        failWith?.let { throw it }
        return events.also { events = emptyList() }
    }
}

class FakeQueue : EventQueue {
    val items = LinkedHashMap<String, OutEvent>()
    override fun put(events: List<OutEvent>) { events.forEach { items[it.key] = it } }
    override fun take(limit: Int) = items.values.take(limit)
    override fun delete(keys: List<String>) { keys.forEach { items.remove(it) } }
    override fun count() = items.size
}

class FakeSyncState : SyncStateStore {
    override var lastSyncMs = 0L
    override var lastError: String? = null
    override var lastUploaded = 0
    override var statusJson: String? = null
}

class FakePrefs : PlayerPreferences {
    override var trackingWanted = false
    override var timerKind = TimerKind.WORK
}

val STATUS_JSON = """{"day":{"id":7,"status":"open","endsAt":"2026-10-26T17:30:00Z","tasksRequired":2,"requiredDone":1},
  "budget":{"earnedMinutes":60,"usedMinutes":35,"remainingMinutes":25,"capMinutes":120},"baseline":false,"pressure":"gradual","gamingApps":["Chess"]}"""

class FakeApi : LifeGameApi {
    val posted = ArrayList<List<OutEvent>>()
    val calls = ArrayList<String>()
    var postFailure: Exception? = null
    var statusFailure: Exception? = null
    var statusJson = STATUS_JSON
    var wakeMessage = "Up before your goal. +15 XP"

    override fun postEvents(events: List<OutEvent>): Int {
        calls.add("post")
        postFailure?.let { throw it }
        posted.add(events)
        return events.size
    }
    override fun statusRaw(): String { calls.add("status"); statusFailure?.let { throw it }; return statusJson }
    override fun wake(): String { calls.add("wake"); return wakeMessage }
    override fun startTimer(kind: TimerKind) { calls.add("start:${kind.id}") }
    override fun stopTimer() { calls.add("stop") }
}

fun events(n: Int, prefix: String = "e") = (1..n).map { OutEvent("$prefix$it", """{"key":"$prefix$it"}""") }

val unauthorized = ApiException(401, "The server does not accept this token. Create a new device in the web app.")

fun parsedStatus(): Status = Status.parse(STATUS_JSON)
