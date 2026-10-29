package app.lifegame.core.model

/** One event in the shape the server's /api/ingest/events expects, plus its key for de-duplication in the queue. */
data class OutEvent(val key: String, val json: String)
