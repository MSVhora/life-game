package app.lifegame.companion

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/**
 * Events waiting to be uploaded. They survive offline periods and restarts.
 * The same key replaces the old row, so a session that keeps growing is sent with its latest length.
 */
class Outbox(context: Context) : SQLiteOpenHelper(context.applicationContext, "outbox.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE outbox (key TEXT PRIMARY KEY, json TEXT NOT NULL, created INTEGER NOT NULL)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    @Synchronized
    fun put(events: List<OutEvent>) {
        if (events.isEmpty()) return
        val db = writableDatabase
        db.beginTransaction()
        try {
            val now = System.currentTimeMillis()
            for (e in events) {
                val cv = ContentValues().apply { put("key", e.key); put("json", e.json); put("created", now) }
                db.insertWithOnConflict("outbox", null, cv, SQLiteDatabase.CONFLICT_REPLACE)
            }
            // A phone that cannot reach the server for weeks must not fill its storage.
            db.execSQL("DELETE FROM outbox WHERE rowid IN (SELECT rowid FROM outbox ORDER BY created ASC LIMIT max(0, (SELECT count(*) FROM outbox) - $MAX_ROWS))")
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    @Synchronized
    fun take(limit: Int): List<OutEvent> {
        val out = ArrayList<OutEvent>()
        readableDatabase.rawQuery("SELECT key, json FROM outbox ORDER BY created ASC LIMIT ?", arrayOf(limit.toString())).use { c ->
            while (c.moveToNext()) out.add(OutEvent(c.getString(0), c.getString(1)))
        }
        return out
    }

    @Synchronized
    fun delete(keys: List<String>) {
        if (keys.isEmpty()) return
        val db = writableDatabase
        db.beginTransaction()
        try {
            keys.chunked(400).forEach { chunk ->
                db.delete("outbox", "key IN (${chunk.joinToString(",") { "?" }})", chunk.toTypedArray())
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    @Synchronized
    fun count(): Int = readableDatabase.rawQuery("SELECT count(*) FROM outbox", null).use { if (it.moveToFirst()) it.getInt(0) else 0 }

    companion object { const val MAX_ROWS = 100_000 }
}
