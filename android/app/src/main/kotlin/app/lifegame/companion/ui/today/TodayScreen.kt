package app.lifegame.companion.ui.today

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.lifegame.companion.ui.components.ProblemBanner
import app.lifegame.companion.ui.components.SectionCard
import app.lifegame.companion.ui.components.rememberNowMs
import app.lifegame.companion.ui.theme.CountdownStyle
import app.lifegame.companion.ui.theme.LifeGameTheme
import app.lifegame.companion.ui.theme.MetricStyle
import app.lifegame.companion.ui.theme.statusColors
import app.lifegame.core.format.Format
import app.lifegame.core.model.Status
import app.lifegame.core.model.TimerKind
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/** Connects the screen to its ViewModel. Everything below takes plain state and callbacks, so it can be previewed. */
@Composable
fun TodayRoute(viewModel: TodayViewModel, snackbar: SnackbarHostState, onOpenSetup: () -> Unit) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) {
        viewModel.messages.collect { snackbar.showSnackbar(it) }
    }
    TodayScreen(
        state = state,
        onRefresh = viewModel::refresh,
        onWake = viewModel::wake,
        onStartTimer = viewModel::startTimer,
        onStopTimer = viewModel::stopTimer,
        onSelectTimerKind = viewModel::selectTimerKind,
        onOpenSetup = onOpenSetup,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TodayScreen(
    state: TodayUiState,
    onRefresh: () -> Unit,
    onWake: () -> Unit,
    onStartTimer: () -> Unit,
    onStopTimer: () -> Unit,
    onSelectTimerKind: (TimerKind) -> Unit,
    onOpenSetup: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Scaffold(
        modifier = modifier,
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = { Text("Today") },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
                actions = {
                    if (state.syncing) {
                        CircularProgressIndicator(Modifier.padding(end = 16.dp).size(24.dp), strokeWidth = 2.dp)
                    } else {
                        IconButton(onClick = onRefresh) { Icon(Icons.Filled.Refresh, contentDescription = "Refresh") }
                    }
                },
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxWidth(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = padding.calculateTopPadding() + 8.dp, bottom = padding.calculateBottomPadding() + 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (!state.configured) {
                item { ConnectCard(onOpenSetup) }
                return@LazyColumn
            }
            if (state.error != null) {
                item { ProblemBanner(state.error, actionLabel = "Retry", onAction = onRefresh) }
            }
            item { DayCard(state.status) }
            state.status?.let { status ->
                item { GameTimeCard(status) }
                item { WakeCard(status, onWake) }
                item { TimerCard(status, state.timerKind, onSelectTimerKind, onStartTimer, onStopTimer) }
            }
            item { SyncFooter(state) }
        }
    }
}

@Composable
private fun ConnectCard(onOpenSetup: () -> Unit) {
    SectionCard(title = "Connect to your server", containerColor = MaterialTheme.colorScheme.primaryContainer, contentColor = MaterialTheme.colorScheme.onPrimaryContainer) {
        Text("Add your server address and the device token from the web app to start tracking.", style = MaterialTheme.typography.bodyMedium)
        Button(onClick = onOpenSetup) { Text("Set up") }
    }
}

@Composable
private fun DayCard(status: Status?) {
    if (status == null) {
        SectionCard { Text("Waiting for the server…", style = MaterialTheme.typography.bodyLarge) }
        return
    }
    if (!status.countsToday) {
        SectionCard(containerColor = MaterialTheme.colorScheme.secondaryContainer, contentColor = MaterialTheme.colorScheme.onSecondaryContainer) {
            Text(if (status.baseline) "Baseline week" else "Day off", style = MaterialTheme.typography.headlineSmall)
            Text(Format.summary(status), style = MaterialTheme.typography.bodyLarge)
        }
        return
    }
    val now by rememberNowMs()
    val left = (status.endsAtMs - now).coerceAtLeast(0)
    val urgent = left < 30 * 60_000
    val soon = left < 2 * 3_600_000
    SectionCard(containerColor = MaterialTheme.colorScheme.primaryContainer, contentColor = MaterialTheme.colorScheme.onPrimaryContainer) {
        Text("DAY ENDS IN", style = MaterialTheme.typography.labelLarge, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
        Text(
            Format.clock(left),
            style = CountdownStyle,
            modifier = Modifier.fillMaxWidth(),
            textAlign = TextAlign.Center,
            color = when {
                urgent -> MaterialTheme.colorScheme.error
                soon -> MaterialTheme.statusColors.warning
                else -> MaterialTheme.colorScheme.onPrimaryContainer
            },
        )
        Text(
            "Ends at ${DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withZone(ZoneId.systemDefault()).format(Instant.ofEpochMilli(status.endsAtMs))}",
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.fillMaxWidth(),
            textAlign = TextAlign.Center,
        )
        val done = status.tasksRequired > 0 && status.requiredDone >= status.tasksRequired
        LinearProgressIndicator(
            progress = { if (status.tasksRequired == 0) 1f else (status.requiredDone.toFloat() / status.tasksRequired).coerceIn(0f, 1f) },
            modifier = Modifier.fillMaxWidth().height(10.dp).clip(RoundedCornerShape(5.dp)),
            color = if (done) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.primary,
            trackColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.6f),
            drawStopIndicator = {},
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("${status.requiredDone} of ${status.tasksRequired} required tasks", style = MaterialTheme.typography.bodyMedium)
            if (done) Text("Done for today", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.tertiary)
        }
    }
}

@Composable
private fun GameTimeCard(status: Status) {
    val over = status.usedMin > status.earnedMin
    SectionCard(title = "Game time") {
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                if (over) "${status.usedMin - status.earnedMin}" else "${status.remainingMin}",
                style = MetricStyle,
                color = if (over) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
            )
            Spacer(Modifier.width(8.dp))
            Text(
                if (over) "min over what you earned" else "min left to play",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 6.dp),
            )
        }
        LinearProgressIndicator(
            progress = { if (status.earnedMin <= 0) (if (status.usedMin > 0) 1f else 0f) else (status.usedMin.toFloat() / status.earnedMin).coerceIn(0f, 1f) },
            modifier = Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)),
            color = if (over) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
            trackColor = MaterialTheme.colorScheme.surfaceVariant,
            drawStopIndicator = {},
        )
        Text(
            "Earned ${status.earnedMin} · used ${status.usedMin} · daily cap ${status.capMin} min",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun WakeCard(status: Status, onWake: () -> Unit) {
    SectionCard(title = "Wake-up") {
        if (status.wakeToday) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = MaterialTheme.colorScheme.tertiary)
                Spacer(Modifier.width(12.dp))
                Text("Logged for today", style = MaterialTheme.typography.bodyLarge)
            }
        } else {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Text(
                    if (status.wakeGoal.isNotBlank()) "Goal: before ${status.wakeGoal}" else "Not logged yet",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                FilledTonalButton(onClick = onWake) { Text("I'm up") }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TimerCard(status: Status, selected: TimerKind, onSelect: (TimerKind) -> Unit, onStart: () -> Unit, onStop: () -> Unit) {
    SectionCard(title = "Timer") {
        val running = status.timerKind
        if (running != null) {
            val now by rememberNowMs()
            val since = status.timerStartedAtMs?.let { (now - it).coerceAtLeast(0) } ?: 0
            Text(Format.clock(since), style = MetricStyle)
            Text("${TimerKind.fromId(running).label} is running", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedButton(onClick = onStop) { Text("Stop timer") }
        } else {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                TimerKind.entries.forEach { kind ->
                    FilterChip(selected = kind == selected, onClick = { onSelect(kind) }, label = { Text(kind.label) })
                }
            }
            Button(onClick = onStart) {
                Icon(Icons.Filled.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("Start ${selected.label.lowercase()}")
            }
        }
    }
}

@Composable
private fun SyncFooter(state: TodayUiState) {
    val now by rememberNowMs(intervalMs = 15_000)
    val ago = if (state.lastSyncMs == 0L) "never" else "${Format.duration(now - state.lastSyncMs)} ago"
    Column(Modifier.fillMaxWidth()) {
        Text(
            "Last sync $ago" + if (state.queued > 0) " · ${state.queued} waiting to upload" else "",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.fillMaxWidth(),
            textAlign = TextAlign.Center,
        )
    }
}

private val previewStatus = Status.parse(
    """{"day":{"id":1,"status":"open","endsAt":"${Instant.now().plusSeconds(6 * 3600 + 780)}","tasksRequired":2,"requiredDone":1},
       "budget":{"earnedMinutes":60,"usedMinutes":35,"remainingMinutes":25,"capMinutes":120},"wake":{"goal":"12:00","today":null},
       "timer":null,"baseline":false,"pressure":"gradual","gamingApps":[]}""",
)

@Preview(showBackground = true, heightDp = 900)
@Composable
private fun TodayPreview() {
    LifeGameTheme(darkTheme = false) {
        TodayScreen(TodayUiState(configured = true, status = previewStatus, lastSyncMs = System.currentTimeMillis() - 90_000), {}, {}, {}, {}, {}, {})
    }
}

@Preview(showBackground = true, heightDp = 900, uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun TodayDarkPreview() {
    LifeGameTheme(darkTheme = true) {
        TodayScreen(TodayUiState(configured = true, status = previewStatus, error = "Cannot reach the server."), {}, {}, {}, {}, {}, {})
    }
}
