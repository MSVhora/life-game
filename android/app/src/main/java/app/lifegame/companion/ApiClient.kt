package app.lifegame.companion

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

class ApiException(val code: Int, message: String) : IOException(message)

/** Talks to the Life Game server with the device token. Plain HttpURLConnection, no libraries. */
class ApiClient(baseUrl: String, private val token: String, private val timeoutMs: Int = 15_000) {
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
        else -> "Request failed ($code)${runCatching { Json.parse(body).asMap()?.get("message") }.getOrNull()?.let { ": $it" } ?: ""}"
    }

    /** Sends events; returns how many the server received. */
    fun postEvents(events: List<OutEvent>): Int {
        val body = Json.obj("events" to Json.Raw(Json.arr(events.map { it.json })))
        val r = Json.parse(call("POST", "/api/ingest/events", body)).asMap()
        return (r?.get("received") as? Double)?.toInt() ?: events.size
    }

    fun statusRaw(): String = call("GET", "/api/device/status")
    fun status(): Status = Status.parse(statusRaw())

    /** Returns the server's message about the wake-up. */
    fun wake(): String {
        val r = Json.parse(call("POST", "/api/device/wake", "{}")).asMap()
        return when {
            r?.get("alreadyLogged") == true -> "Already logged today."
            r?.get("beforeGoal") == true -> "Up before your goal. +${(r["xp"] as? Double)?.toInt() ?: 0} XP"
            else -> "Logged. +${(r?.get("xp") as? Double)?.toInt() ?: 0} XP"
        }
    }

    fun startTimer(kind: String) { call("POST", "/api/device/timers/start", Json.obj("kind" to kind)) }
    fun stopTimer() { call("POST", "/api/device/timers/stop", "{}") }
}
