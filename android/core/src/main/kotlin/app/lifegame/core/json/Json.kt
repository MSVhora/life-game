package app.lifegame.core.json

/** A tiny JSON writer and reader, so the logic runs on a plain JVM in unit tests (no Android classes). */
object Json {
    /** Wrap already-encoded JSON so [obj] and [arr] insert it as is. */
    class Raw(val text: String)

    fun str(s: String): String {
        val sb = StringBuilder("\"")
        for (c in s) {
            when {
                c == '"' -> sb.append("\\\"")
                c == '\\' -> sb.append("\\\\")
                c == '\n' -> sb.append("\\n")
                c == '\r' -> sb.append("\\r")
                c == '\t' -> sb.append("\\t")
                c < ' ' -> sb.append(String.format("\\u%04x", c.code))
                else -> sb.append(c)
            }
        }
        return sb.append('"').toString()
    }

    fun value(v: Any?): String = when (v) {
        null -> "null"
        is Raw -> v.text
        is String -> str(v)
        is Boolean -> v.toString()
        is Int, is Long -> v.toString()
        is Double -> if (v % 1.0 == 0.0 && Math.abs(v) < 1e15) v.toLong().toString() else v.toString()
        is Float -> value(v.toDouble())
        else -> throw IllegalArgumentException("Cannot encode ${v::class}")
    }

    fun obj(vararg pairs: Pair<String, Any?>): String =
        pairs.joinToString(",", "{", "}") { (k, v) -> "${str(k)}:${value(v)}" }

    fun arr(items: List<String>): String = items.joinToString(",", "[", "]")

    /** Parses JSON into Map, List, String, Double, Boolean or null. Throws [IllegalArgumentException] on bad input. */
    fun parse(text: String): Any? {
        val p = Parser(text)
        p.skip()
        val v = p.readValue()
        p.skip()
        require(p.done()) { "Unexpected data after JSON value at ${p.pos}" }
        return v
    }

    private class Parser(val s: String) {
        var pos = 0
        fun done() = pos >= s.length
        fun skip() { while (pos < s.length && s[pos].isWhitespace()) pos++ }
        private fun peek(): Char { require(pos < s.length) { "Unexpected end of JSON" }; return s[pos] }
        private fun expect(c: Char) { require(peek() == c) { "Expected '$c' at $pos" }; pos++ }

        fun readValue(): Any? {
            skip()
            return when (val c = peek()) {
                '{' -> readObject()
                '[' -> readArray()
                '"' -> readString()
                't' -> { literal("true"); true }
                'f' -> { literal("false"); false }
                'n' -> { literal("null"); null }
                else -> if (c == '-' || c.isDigit()) readNumber() else throw IllegalArgumentException("Unexpected '$c' at $pos")
            }
        }

        private fun literal(w: String) { require(s.startsWith(w, pos)) { "Bad literal at $pos" }; pos += w.length }

        private fun readNumber(): Double {
            val start = pos
            while (pos < s.length && (s[pos].isDigit() || s[pos] in "+-.eE")) pos++
            return s.substring(start, pos).toDouble()
        }

        private fun readString(): String {
            expect('"')
            val sb = StringBuilder()
            while (true) {
                val c = peek(); pos++
                when (c) {
                    '"' -> return sb.toString()
                    '\\' -> {
                        val e = peek(); pos++
                        when (e) {
                            'n' -> sb.append('\n'); 't' -> sb.append('\t'); 'r' -> sb.append('\r')
                            'b' -> sb.append('\b'); 'f' -> sb.append('\u000c')
                            'u' -> { sb.append(s.substring(pos, pos + 4).toInt(16).toChar()); pos += 4 }
                            else -> sb.append(e)
                        }
                    }
                    else -> sb.append(c)
                }
            }
        }

        private fun readArray(): List<Any?> {
            expect('[')
            val out = ArrayList<Any?>()
            skip()
            if (peek() == ']') { pos++; return out }
            while (true) {
                out.add(readValue()); skip()
                when (peek()) { ',' -> pos++; ']' -> { pos++; return out }; else -> throw IllegalArgumentException("Expected , or ] at $pos") }
            }
        }

        private fun readObject(): Map<String, Any?> {
            expect('{')
            val out = LinkedHashMap<String, Any?>()
            skip()
            if (peek() == '}') { pos++; return out }
            while (true) {
                skip(); val k = readString(); skip(); expect(':')
                out[k] = readValue(); skip()
                when (peek()) { ',' -> pos++; '}' -> { pos++; return out }; else -> throw IllegalArgumentException("Expected , or } at $pos") }
            }
        }
    }
}

@Suppress("UNCHECKED_CAST")
fun Any?.asMap(): Map<String, Any?>? = this as? Map<String, Any?>

@Suppress("UNCHECKED_CAST")
fun Any?.asList(): List<Any?>? = this as? List<Any?>
