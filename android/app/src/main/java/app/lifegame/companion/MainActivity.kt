package app.lifegame.companion

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast

/** One screen: connect to the server, grant the three permissions, start tracking, and use quick actions. */
class MainActivity : Activity() {
    private lateinit var prefs: Prefs
    private val handler = Handler(Looper.getMainLooper())

    private lateinit var countdown: TextView
    private lateinit var summary: TextView
    private lateinit var diagnostics: TextView
    private lateinit var url: EditText
    private lateinit var token: EditText
    private lateinit var usageRow: TextView
    private lateinit var notifRow: TextView
    private lateinit var batteryRow: TextView
    private lateinit var trackingBtn: Button

    private val ticker = object : Runnable {
        override fun run() {
            renderStatus()
            handler.postDelayed(this, 1000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        Notifier.ensureChannels(this)
        setContentView(buildUi())
        // Used by scripted checks: `am start ... --ez autostart true`.
        if (intent.getBooleanExtra("autostart", false) && prefs.configured) startTracking()
    }

    override fun onResume() {
        super.onResume()
        refreshPermissions()
        handler.post(ticker)
        if (prefs.configured) background { SyncEngine.runOnce(this); ui { renderStatus() } }
    }

    override fun onPause() {
        handler.removeCallbacks(ticker)
        super.onPause()
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private fun ui(block: () -> Unit) = runOnUiThread(block)
    private fun background(block: () -> Unit) = Thread(block).start()
    private fun toast(msg: String) = ui { Toast.makeText(this, msg, Toast.LENGTH_LONG).show() }

    private fun text(s: String, size: Float = 15f, bold: Boolean = false) = TextView(this).apply {
        text = s; textSize = size
        if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
        setPadding(0, dp(4), 0, dp(4))
    }

    private fun button(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label; isAllCaps = false; setOnClickListener { onClick() }
    }

    private fun section(parent: LinearLayout, title: String): LinearLayout {
        parent.addView(text(title, 18f, true).apply { setPadding(0, dp(20), 0, dp(4)) })
        return parent
    }

    private fun buildUi(): View {
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(16), dp(16), dp(32)) }

        col.addView(text("Life Game", 26f, true))
        countdown = text("", 34f, true).apply { gravity = Gravity.CENTER_HORIZONTAL }
        col.addView(countdown)
        summary = text("", 16f).apply { gravity = Gravity.CENTER_HORIZONTAL }
        col.addView(summary)

        section(col, "Quick actions")
        col.addView(button("I'm up") {
            background {
                try { toast(ApiClient(prefs.serverUrl, prefs.token).wake()); SyncEngine.runOnce(this); ui { renderStatus() } }
                catch (e: Exception) { toast(e.message ?: "Failed") }
            }
        })
        val kinds = listOf("work", "lunch", "dinner", "wash", "bath", "sleep", "reading", "gaming", "out", "other")
        val spinner = Spinner(this).apply {
            adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, kinds)
            setSelection(kinds.indexOf(prefs.timerKind).coerceAtLeast(0))
            onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
                override fun onItemSelected(p: AdapterView<*>?, v: View?, pos: Int, id: Long) { prefs.timerKind = kinds[pos] }
                override fun onNothingSelected(p: AdapterView<*>?) = Unit
            }
        }
        col.addView(spinner)
        val timers = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        timers.addView(button("Start timer") {
            background {
                try { ApiClient(prefs.serverUrl, prefs.token).startTimer(prefs.timerKind); SyncEngine.runOnce(this); ui { renderStatus() }; toast("${prefs.timerKind} started") }
                catch (e: Exception) { toast(e.message ?: "Failed") }
            }
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        timers.addView(button("Stop timer") {
            background {
                try { ApiClient(prefs.serverUrl, prefs.token).stopTimer(); SyncEngine.runOnce(this); ui { renderStatus() }; toast("Timer stopped") }
                catch (e: Exception) { toast(e.message ?: "Failed") }
            }
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        col.addView(timers)
        col.addView(text("Tip: add the \"I'm up\" and \"Timer\" tiles to your quick settings panel.", 13f))

        section(col, "Connect to your server")
        url = EditText(this).apply { hint = "https://life.yourdomain.tld"; setText(prefs.serverUrl); inputType = InputType.TYPE_TEXT_VARIATION_URI; setSingleLine() }
        token = EditText(this).apply {
            hint = if (prefs.token.isNotBlank()) "Token saved (enter a new one to replace it)" else "Device token (starts with lg_)"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD; setSingleLine()
        }
        col.addView(url); col.addView(token)
        col.addView(button("Save and test connection") { saveAndTest() })
        col.addView(text("Create the token in the web app: More > Connect a device.", 13f))

        section(col, "Permissions")
        usageRow = text("", 14f); notifRow = text("", 14f); batteryRow = text("", 14f)
        col.addView(usageRow)
        col.addView(button("Allow usage access") { startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS, Uri.parse("package:$packageName"))) })
        col.addView(notifRow)
        col.addView(button("Allow notifications") {
            if (Build.VERSION.SDK_INT >= 33) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        })
        col.addView(batteryRow)
        col.addView(button("Don't restrict battery") {
            startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
        })

        section(col, "Tracking")
        trackingBtn = button("Start tracking") { if (prefs.trackingWanted) stopTracking() else startTracking() }
        col.addView(trackingBtn)
        col.addView(button("Sync now") {
            background { val r = SyncEngine.runOnce(this); ui { renderStatus() }; toast(r.error ?: "Synced ${r.uploaded} events") }
        })
        diagnostics = text("", 13f)
        col.addView(diagnostics)

        val scroll = ScrollView(this)
        scroll.addView(col)
        scroll.setOnApplyWindowInsetsListener { v, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val b = insets.getInsets(android.view.WindowInsets.Type.systemBars())
                v.setPadding(b.left, b.top, b.right, b.bottom)
            } else {
                @Suppress("DEPRECATION")
                v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }
        return scroll
    }

    private fun saveAndTest() {
        val u = url.text.toString().trim()
        val t = token.text.toString().trim()
        if (u.isEmpty()) { toast("Enter the server address."); return }
        prefs.serverUrl = u
        if (t.isNotEmpty()) prefs.token = t
        if (prefs.token.isEmpty()) { toast("Enter the device token."); return }
        background {
            try {
                val s = ApiClient(prefs.serverUrl, prefs.token).status()
                prefs.statusJson = ApiClient(prefs.serverUrl, prefs.token).statusRaw()
                toast("Connected. ${Format.summary(s)}")
                ui { token.setText(""); token.hint = "Token saved (enter a new one to replace it)"; renderStatus() }
            } catch (e: Exception) {
                toast(e.message ?: "Could not connect")
            }
        }
    }

    private fun startTracking() {
        if (!prefs.configured) { toast("Connect to your server first."); return }
        runCatching { TrackingService.start(this) }.onFailure { toast("Could not start: ${it.message}") }
        prefs.trackingWanted = true
        renderStatus()
    }

    private fun stopTracking() {
        TrackingService.stop(this)
        prefs.trackingWanted = false
        renderStatus()
    }

    private fun refreshPermissions() {
        val usage = Collector.hasUsageAccess(this)
        usageRow.text = (if (usage) "✓ " else "✗ ") + "Usage access: " + if (usage) "allowed" else "needed to see which apps you use"
        val notif = Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        notifRow.text = (if (notif) "✓ " else "✗ ") + "Notifications: " + if (notif) "allowed" else "needed for the countdown and nudges"
        val battery = getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName)
        batteryRow.text = (if (battery) "✓ " else "! ") + "Battery: " + if (battery) "unrestricted" else "restricted, the phone may stop tracking"
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        refreshPermissions()
    }

    private fun renderStatus() {
        refreshPermissions()
        val status = prefs.status()
        summary.text = Format.summary(status).let { s ->
            if (status != null && status.timerKind != null) "$s\nTimer running: ${status.timerKind}" else s
        }
        val left = (status?.endsAtMs ?: 0) - System.currentTimeMillis()
        countdown.text = if (status != null && status.countsToday && left > 0) {
            val s = left / 1000
            "%d:%02d:%02d".format(s / 3600, (s % 3600) / 60, s % 60)
        } else ""
        trackingBtn.text = if (prefs.trackingWanted) "Stop tracking" else "Start tracking"
        val ago = if (prefs.lastSyncMs == 0L) "never" else Format.duration(System.currentTimeMillis() - prefs.lastSyncMs) + " ago"
        diagnostics.text = "Last sync: $ago · queued: ${Outbox(this).count()} · last upload: ${prefs.lastUploaded}" +
            (prefs.lastError?.let { "\nProblem: $it" } ?: "")
    }
}
