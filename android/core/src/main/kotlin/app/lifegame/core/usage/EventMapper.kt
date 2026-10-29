package app.lifegame.core.usage

import app.lifegame.core.json.Json
import app.lifegame.core.model.OutEvent

import java.time.Instant

object EventMapper {
    fun iso(ms: Long): String = Instant.ofEpochMilli(ms).toString()

    fun session(s: Session, appLabel: String): OutEvent {
        val key = "${s.pkg}:${s.start}"
        val json = Json.obj(
            "source" to "android",
            "kind" to "app_usage",
            "ts" to iso(s.start),
            "durationSec" to Math.round(s.seconds * 1000) / 1000.0,
            "key" to key,
            "data" to Json.Raw(Json.obj("app" to appLabel, "package" to s.pkg)),
        )
        return OutEvent(key, json)
    }

    fun screen(e: ScreenEvent): OutEvent {
        val key = "${e.kind}:${e.ts}"
        val json = Json.obj("source" to "android", "kind" to e.kind, "ts" to iso(e.ts), "durationSec" to 0, "key" to key, "data" to Json.Raw("{}"))
        return OutEvent(key, json)
    }
}
