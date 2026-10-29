package app.lifegame.companion.ui.setup

import android.Manifest
import android.content.Intent
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.lifegame.companion.system.PermissionChecker
import app.lifegame.companion.system.PermissionState
import app.lifegame.companion.ui.components.PermissionRow
import app.lifegame.companion.ui.components.SectionCard
import app.lifegame.companion.ui.theme.LifeGameTheme
import app.lifegame.core.format.Format
import kotlinx.coroutines.launch

@Composable
fun SetupRoute(viewModel: SetupViewModel, permissions: PermissionChecker, snackbar: SnackbarHostState) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    LifecycleResumeEffect(viewModel) {
        viewModel.refreshPermissions()
        onPauseOrDispose { }
    }
    val notificationLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { viewModel.refreshPermissions() }

    SetupScreen(
        state = state,
        onUrlChange = viewModel::onUrlChange,
        onTokenChange = viewModel::onTokenChange,
        onSaveAndTest = viewModel::saveAndTest,
        onAllowUsage = { context.startActivity(permissions.usageAccessIntent()) },
        onAllowNotifications = { if (Build.VERSION.SDK_INT >= 33) notificationLauncher.launch(Manifest.permission.POST_NOTIFICATIONS) },
        onAllowBattery = { context.startActivity(permissions.batteryIntent()) },
        onTrackingChange = { on -> viewModel.setTracking(on)?.let { msg -> scope.launch { snackbar.showSnackbar(msg) } } },
        onSyncNow = viewModel::syncNow,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SetupScreen(
    state: SetupUiState,
    onUrlChange: (String) -> Unit,
    onTokenChange: (String) -> Unit,
    onSaveAndTest: () -> Unit,
    onAllowUsage: () -> Unit,
    onAllowNotifications: () -> Unit,
    onAllowBattery: () -> Unit,
    onTrackingChange: (Boolean) -> Unit,
    onSyncNow: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Scaffold(
        modifier = modifier,
        containerColor = MaterialTheme.colorScheme.background,
        topBar = { TopAppBar(title = { Text("Setup") }, colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background)) },
    ) { padding ->
        Column(
            modifier = Modifier.verticalScroll(rememberScrollState()).padding(padding).padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            ConnectionCard(state, onUrlChange, onTokenChange, onSaveAndTest)
            PermissionsCard(state.permissions, onAllowUsage, onAllowNotifications, onAllowBattery)
            TrackingCard(state, onTrackingChange, onSyncNow)
            Text(
                "Life Game ${state.versionName}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp),
            )
        }
    }
}

@Composable
private fun ConnectionCard(state: SetupUiState, onUrlChange: (String) -> Unit, onTokenChange: (String) -> Unit, onSaveAndTest: () -> Unit) {
    SectionCard(title = "Your server") {
        OutlinedTextField(
            value = state.urlDraft, onValueChange = onUrlChange, label = { Text("Server address") },
            placeholder = { Text("https://life.yourdomain.tld") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
        )
        OutlinedTextField(
            value = state.tokenDraft, onValueChange = onTokenChange, label = { Text("Device token") },
            supportingText = { Text(if (state.tokenSaved) "A token is saved. Leave empty to keep it." else "Create it in the web app: More > Connect a device.") },
            singleLine = true, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Button(onClick = onSaveAndTest, enabled = !state.saving) { Text("Save and test") }
            if (state.saving) CircularProgressIndicator(Modifier.padding(start = 16.dp).size(24.dp), strokeWidth = 2.dp)
        }
        when (val r = state.connectionResult) {
            is ConnectionResult.Success -> Text(r.summary, color = MaterialTheme.colorScheme.tertiary, style = MaterialTheme.typography.bodyMedium)
            is ConnectionResult.Failure -> Text(r.reason, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            null -> Unit
        }
    }
}

@Composable
private fun PermissionsCard(p: PermissionState, onUsage: () -> Unit, onNotifications: () -> Unit, onBattery: () -> Unit) {
    SectionCard(title = "Permissions") {
        PermissionRow("Usage access", "Needed to see which apps you use.", p.usageAccess, "Allow", onUsage)
        PermissionRow("Notifications", "For the countdown and game-time nudges.", p.notifications, "Allow", onNotifications)
        PermissionRow(
            "Battery", if (p.batteryUnrestricted) "Unrestricted, so tracking keeps running." else "Restricted: the phone may stop tracking in the background.",
            p.batteryUnrestricted, "Fix", onBattery, required = false,
        )
    }
}

@Composable
private fun TrackingCard(state: SetupUiState, onTrackingChange: (Boolean) -> Unit, onSyncNow: () -> Unit) {
    SectionCard(title = "Tracking") {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Track this phone", style = MaterialTheme.typography.bodyLarge)
                Text(
                    if (state.trackingOn) "On: shows the countdown and uploads usage." else "Off: nothing is measured.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Switch(checked = state.trackingOn, onCheckedChange = onTrackingChange)
        }
        OutlinedButton(onClick = onSyncNow, enabled = !state.syncing) { Text(if (state.syncing) "Syncing…" else "Sync now") }
        val ago = if (state.lastSyncMs == 0L) "never" else "${Format.duration(System.currentTimeMillis() - state.lastSyncMs)} ago"
        Text(
            "Last sync $ago · ${state.queued} waiting · last upload ${state.lastUploaded} events",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        state.lastError?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
    }
}

@Preview(showBackground = true, heightDp = 1000)
@Composable
private fun SetupPreview() {
    LifeGameTheme(darkTheme = false) {
        SetupScreen(
            SetupUiState(
                urlDraft = "https://life.example.com", tokenSaved = true, trackingOn = true, lastSyncMs = System.currentTimeMillis() - 120_000, queued = 3, lastUploaded = 41,
                permissions = PermissionState(usageAccess = true, notifications = true, batteryUnrestricted = false), versionName = "0.2.0",
                connectionResult = ConnectionResult.Success("Connected. 1 of 2 tasks · 25 min game time left"),
            ),
            {}, {}, {}, {}, {}, {}, {}, {},
        )
    }
}
