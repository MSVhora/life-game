package app.lifegame.core.net

import app.lifegame.core.model.OutEvent
import app.lifegame.core.model.Status
import app.lifegame.core.model.TimerKind

/** Everything the phone asks of the server. An interface, so tests can use fakes. */
interface LifeGameApi {
    /** Sends events; returns how many the server received. */
    fun postEvents(events: List<OutEvent>): Int

    /** The raw status JSON (kept so it can be cached) and its parsed form. */
    fun statusRaw(): String
    fun status(): Status = Status.parse(statusRaw())

    /** Logs the wake-up; returns a sentence for the player. */
    fun wake(): String

    fun startTimer(kind: TimerKind)
    fun stopTimer()
}
