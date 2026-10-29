package app.lifegame.core.sync

import app.lifegame.core.model.OutEvent
import app.lifegame.core.model.TimerKind
import app.lifegame.core.net.LifeGameApi

/** Where the server is and how to prove who we are. */
data class Connection(val serverUrl: String, val token: String)

/** The ports below are implemented in :data on Android and by simple fakes in tests. */
interface ConnectionStore {
    /** The saved address, even when the token is still missing. */
    val serverUrl: String

    /** Null until both the address and the token are set. */
    fun current(): Connection?

    /** Saves the address; the token only when [token] is not null or blank (so it can be left as is). */
    fun save(serverUrl: String, token: String?)
}

/** Source of phone usage events. */
interface UsageSource {
    /** Whether the player has granted the permission needed to read usage. */
    val hasAccess: Boolean

    /** Label of the app in the foreground as of the last [collect], or null. */
    val foregroundApp: String?

    /** Events since the last call, ready to upload. */
    fun collect(nowMs: Long): List<OutEvent>
}

/** Events waiting to be uploaded. The same key replaces the old entry (a growing session is re-sent). */
interface EventQueue {
    fun put(events: List<OutEvent>)
    fun take(limit: Int): List<OutEvent>
    fun delete(keys: List<String>)
    fun count(): Int
}

/** What the last sync learned and how it went. */
interface SyncStateStore {
    var lastSyncMs: Long
    var lastError: String?
    var lastUploaded: Int
    var statusJson: String?
}

/** Choices the player made. */
interface PlayerPreferences {
    var trackingWanted: Boolean
    var timerKind: TimerKind
}

fun interface ApiFactory {
    fun create(connection: Connection): LifeGameApi
}
