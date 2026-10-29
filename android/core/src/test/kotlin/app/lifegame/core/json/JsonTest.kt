package app.lifegame.core.json

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class JsonTest {
    @Test fun escapesSpecialCharacters() {
        assertEquals("\"a\\\"b\\\\c\\n\\t\"", Json.str("a\"b\\c\n\t"))
        assertEquals("\"\\u0001\"", Json.str("\u0001"))
        assertEquals("\"héllo ✓\"", Json.str("héllo ✓"))
    }

    @Test fun buildsObjectsAndArrays() {
        val o = Json.obj("a" to 1, "b" to "x", "c" to true, "d" to null, "e" to 2.5, "f" to Json.Raw("{\"k\":1}"))
        assertEquals("{\"a\":1,\"b\":\"x\",\"c\":true,\"d\":null,\"e\":2.5,\"f\":{\"k\":1}}", o)
        assertEquals("[1,2]", Json.arr(listOf("1", "2")))
        assertEquals("[]", Json.arr(emptyList()))
    }

    @Test fun wholeDoublesHaveNoDecimalPoint() {
        assertEquals("30", Json.value(30.0))
        assertEquals("0.5", Json.value(0.5))
    }

    @Test fun parsesWhatItWrites() {
        val text = Json.obj("name" to "O'Brien \"Q\"\nline", "n" to 3, "list" to Json.Raw("[1,[2],{\"x\":null}]"), "ok" to false)
        val m = Json.parse(text).asMap()!!
        assertEquals("O'Brien \"Q\"\nline", m["name"])
        assertEquals(3.0, m["n"])
        assertEquals(false, m["ok"])
        val list = m["list"].asList()!!
        assertEquals(1.0, list[0]); assertEquals(listOf(2.0), list[1]); assertNull(list[2].asMap()!!["x"])
    }

    @Test fun parsesUnicodeEscapesAndNumbers() {
        assertEquals("A", Json.parse("\"\\u0041\""))
        assertEquals(-1.5e2, Json.parse(" -1.5e2 "))
        assertEquals(emptyMap<String, Any?>(), Json.parse("{}"))
    }

    @Test fun rejectsBadJson() {
        for (bad in listOf("", "{", "[1,", "{\"a\" 1}", "nul", "{} extra", "\"unterminated")) {
            try { Json.parse(bad); fail("should reject: $bad") } catch (_: IllegalArgumentException) { }
        }
    }

    @Test fun refusesUnknownTypes() {
        try { Json.value(Any()); fail() } catch (e: IllegalArgumentException) { assertTrue(e.message!!.contains("Cannot encode")) }
    }
}
