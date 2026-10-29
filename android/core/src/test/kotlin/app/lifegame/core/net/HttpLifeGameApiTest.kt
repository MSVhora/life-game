package app.lifegame.core.net

import app.lifegame.core.json.Json
import app.lifegame.core.json.asList
import app.lifegame.core.json.asMap
import app.lifegame.core.model.TimerKind
import app.lifegame.core.usage.EventMapper
import app.lifegame.core.usage.ScreenEvent
import app.lifegame.core.usage.Session

import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class HttpLifeGameApiTest {
    private lateinit var server: HttpServer
    private val seen = ArrayList<Triple<String, String, String>>() // method+path, auth, body
    private var status = 200
    private var reply = "{}"
    private val base get() = "http://127.0.0.1:${server.address.port}"

    @Before fun start() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { ex ->
            val body = ex.requestBody.readBytes().toString(Charsets.UTF_8)
            seen.add(Triple("${ex.requestMethod} ${ex.requestURI.path}", ex.requestHeaders.getFirst("Authorization") ?: "", body))
            val bytes = reply.toByteArray()
            ex.sendResponseHeaders(status, bytes.size.toLong())
            ex.responseBody.use { it.write(bytes) }
        }
        server.start()
    }

    @After fun stop() = server.stop(0)

    @Test fun postsEventsWithTheTokenAndTheExpectedShape() {
        reply = """{"received":2,"inserted":2,"updated":0}"""
        val events = listOf(EventMapper.screen(ScreenEvent("unlock", 1000)), EventMapper.session(Session("p", 2000, 9000, false), "P"))
        assertEquals(2, HttpLifeGameApi(base, "lg_secret").postEvents(events))
        val (call, auth, body) = seen.single()
        assertEquals("POST /api/ingest/events", call); assertEquals("Bearer lg_secret", auth)
        val list = Json.parse(body).asMap()!!["events"].asList()!!
        assertEquals(listOf("unlock", "app_usage"), list.map { it.asMap()!!["kind"] })
    }

    @Test fun explainsARefusedToken() {
        status = 401
        try { HttpLifeGameApi(base, "bad").postEvents(listOf(EventMapper.screen(ScreenEvent("unlock", 1)))); fail() }
        catch (e: ApiException) { assertEquals(401, e.code); assertTrue(e.message!!.contains("token")) }
    }

    @Test fun reportsServerErrorsAndKeepsTheCode() {
        status = 503
        try { HttpLifeGameApi(base, "t").statusRaw(); fail() } catch (e: ApiException) { assertEquals(503, e.code); assertTrue(e.message!!.contains("503")) }
    }

    @Test fun includesTheServersMessageFor4xx() {
        status = 409; reply = """{"error":"day_closed","message":"That day has ended"}"""
        try { HttpLifeGameApi(base, "t").wake(); fail() } catch (e: ApiException) { assertTrue(e.message!!.contains("That day has ended")) }
    }

    @Test fun readsStatus() {
        reply = """{"day":{"id":1,"status":"open","endsAt":"2026-10-26T17:30:00Z","tasksRequired":2,"requiredDone":0},"budget":{"remainingMinutes":10}}"""
        val s = HttpLifeGameApi(base, "t").status()
        assertEquals(10, s.remainingMin)
        assertEquals("GET /api/device/status", seen.single().first)
    }

    @Test fun describesTheWakeResult() {
        reply = """{"wokeAt":"x","beforeGoal":true,"xp":15,"alreadyLogged":false}"""
        assertEquals("Up before your goal. +15 XP", HttpLifeGameApi(base, "t").wake())
        reply = """{"alreadyLogged":true,"xp":0}"""
        assertEquals("Already logged today.", HttpLifeGameApi(base, "t").wake())
        reply = """{"beforeGoal":false,"xp":5,"alreadyLogged":false}"""
        assertEquals("Logged. +5 XP", HttpLifeGameApi(base, "t").wake())
    }

    @Test fun startsAndStopsTimers() {
        status = 204; reply = ""
        HttpLifeGameApi(base, "t").startTimer(TimerKind.WORK)
        status = 200; reply = """{"stopped":null}"""
        HttpLifeGameApi(base, "t").stopTimer()
        assertEquals(listOf("POST /api/device/timers/start", "POST /api/device/timers/stop"), seen.map { it.first })
        assertEquals("""{"kind":"work"}""", seen[0].third)
    }

    @Test fun anUnreachableServerThrowsAnIoError() {
        val dead = HttpLifeGameApi("http://127.0.0.1:1", "t", timeoutMs = 500)
        try { dead.statusRaw(); fail() } catch (e: java.io.IOException) { /* expected */ }
    }
}
