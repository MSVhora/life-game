package app.lifegame.core.net

import app.lifegame.core.json.Json
import app.lifegame.core.json.asMap
import app.lifegame.core.model.OutEvent
import app.lifegame.core.model.TimerKind
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

class ApiException(val code: Int, message: String) : IOException(message)

/** [LifeGameApi] over HTTPS with the device token. Plain HttpURLConnection: no networking library needed. */
class HttpLifeGameApi(baseUrl: String, private val token: String, private val timeoutMs: Int = 15_000) : LifeGameApi {
    private val base = baseUrl.trimEnd('/')

    private fun call(method: String, path: String, body: String? = null): String {
        val conn = URL("$base$path").openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = timeoutMs
            conn.readTimeout = timeoutMs
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.setRequestProperty("Accept", "application/json")
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(body.toByteArray()) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            if (code !in 200..299) throw ApiException(code, errorMessage(code, text))
            return text
        } finally {
            conn.disconnect()
        }
    }

    private fun errorMessage(code: Int, body: String): String = when (code) {
        401 -> "The server does not accept this token. Create a new device in the web app."
        in 500..599 -> "The server had a problem ($code)."
        else -> "Request failed ($code)" + (runCatching { Json.parse(body).asMap()?.get("message") }.getOrNull()?.let { ": $it" } ?: "")
    }

    override fun postEvents(events: List<OutEvent>): Int {
        val body = Json.obj("events" to Json.Raw(Json.arr(events.map { it.json })))
        val r = Json.parse(call("POST", "/api/ingest/events", body)).asMap()
        return (r?.get("received") as? Double)?.toInt() ?: events.size
    }

    override fun statusRaw(): String = call("GET", "/api/device/status")

    override fun wake(): String {
        val r = Json.parse(call("POST", "/api/device/wake", "{}")).asMap()
        val xp = (r?.get("xp") as? Double)?.toInt() ?: 0
        return when {
            r?.get("alreadyLogged") == true -> "Already logged today."
            r?.get("beforeGoal") == true -> "Up before your goal. +$xp XP"
            else -> "Logged. +$xp XP"
        }
    }

    override fun startTimer(kind: TimerKind) {
        call("POST", "/api/device/timers/start", Json.obj("kind" to kind.id))
    }

    override fun stopTimer() {
        call("POST", "/api/device/timers/stop", "{}")
    }
}
