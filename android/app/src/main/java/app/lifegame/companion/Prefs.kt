package app.lifegame.companion

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Encrypts the device token with a key that never leaves the Android Keystore. */
object SecretBox {
    private const val ALIAS = "lifegame_token_key"

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build(),
        )
        return gen.generateKey()
    }

    fun encrypt(plain: String): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val out = c.iv + c.doFinal(plain.toByteArray())
        return Base64.encodeToString(out, Base64.NO_WRAP)
    }

    fun decrypt(stored: String): String? = try {
        val raw = Base64.decode(stored, Base64.NO_WRAP)
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw, 0, 12)) }
        String(c.doFinal(raw, 12, raw.size - 12))
    } catch (_: Exception) {
        null // key lost (for example after a restore): the user enters the token again
    }
}

class Prefs(context: Context) {
    private val sp: SharedPreferences = context.applicationContext.getSharedPreferences("lifegame", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = sp.getString("serverUrl", "") ?: ""
        set(v) = sp.edit().putString("serverUrl", v.trim().trimEnd('/')).apply()

    var token: String
        get() = sp.getString("token", null)?.let { SecretBox.decrypt(it) } ?: ""
        set(v) = sp.edit().putString("token", if (v.isBlank()) null else SecretBox.encrypt(v.trim())).apply()

    val configured: Boolean get() = serverUrl.isNotBlank() && token.isNotBlank()

    /** Phone events up to this time were collected. */
    var checkpointMs: Long
        get() = sp.getLong("checkpoint", 0)
        set(v) = sp.edit().putLong("checkpoint", v).apply()

    /** The foreground session that was still open at the last collection, so it can be resumed. */
    var openPkg: String?
        get() = sp.getString("openPkg", null)
        set(v) = sp.edit().putString("openPkg", v).apply()
    var openStartMs: Long
        get() = sp.getLong("openStart", 0)
        set(v) = sp.edit().putLong("openStart", v).apply()

    var lastSyncMs: Long
        get() = sp.getLong("lastSync", 0)
        set(v) = sp.edit().putLong("lastSync", v).apply()
    var lastError: String?
        get() = sp.getString("lastError", null)
        set(v) = sp.edit().putString("lastError", v).apply()
    var lastUploaded: Int
        get() = sp.getInt("lastUploaded", 0)
        set(v) = sp.edit().putInt("lastUploaded", v).apply()

    var statusJson: String?
        get() = sp.getString("status", null)
        set(v) = sp.edit().putString("status", v).apply()

    var timerKind: String
        get() = sp.getString("timerKind", "work") ?: "work"
        set(v) = sp.edit().putString("timerKind", v).apply()

    var trackingWanted: Boolean
        get() = sp.getBoolean("trackingWanted", false)
        set(v) = sp.edit().putBoolean("trackingWanted", v).apply()

    var nudgeLowDay: Long
        get() = sp.getLong("nudgeLowDay", -1)
        set(v) = sp.edit().putLong("nudgeLowDay", v).apply()
    var nudgeOverAt: Long
        get() = sp.getLong("nudgeOverAt", 0)
        set(v) = sp.edit().putLong("nudgeOverAt", v).apply()

    fun status(): Status? = statusJson?.let { runCatching { Status.parse(it) }.getOrNull() }
}
