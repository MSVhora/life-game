package app.lifegame.companion.ui.setup

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.lifegame.companion.system.PermissionSource
import app.lifegame.companion.system.PermissionState
import app.lifegame.companion.system.TrackingSwitch
import app.lifegame.core.format.Format
import app.lifegame.core.repository.LifeGameRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class SetupViewModel(
    private val repository: LifeGameRepository,
    private val permissions: PermissionSource,
    private val tracking: TrackingSwitch,
    private val versionName: String,
) : ViewModel() {
    private data class Draft(
        val url: String, val token: String, val saving: Boolean, val result: ConnectionResult?, val permissions: PermissionState,
    )

    private val draft = MutableStateFlow(
        Draft(url = repository.state.value.serverUrl, token = "", saving = false, result = null, permissions = permissions.check()),
    )

    val uiState: StateFlow<SetupUiState> = combine(repository.state, draft) { app, d ->
        SetupUiState(
            urlDraft = d.url, tokenDraft = d.token, tokenSaved = app.configured, saving = d.saving, connectionResult = d.result,
            permissions = d.permissions, trackingOn = app.trackingWanted, syncing = app.syncing, lastSyncMs = app.lastSyncMs,
            queued = app.queued, lastUploaded = app.lastUploaded, lastError = app.lastError, versionName = versionName,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SetupUiState(urlDraft = draft.value.url, versionName = versionName))

    fun onUrlChange(value: String) = draft.update { it.copy(url = value, result = null) }

    fun onTokenChange(value: String) = draft.update { it.copy(token = value, result = null) }

    /** Call when the screen comes back into view: the player may have changed a permission in Settings. */
    fun refreshPermissions() = draft.update { it.copy(permissions = permissions.check()) }

    fun saveAndTest() {
        val d = draft.value
        if (d.saving) return
        draft.update { it.copy(saving = true, result = null) }
        viewModelScope.launch {
            val result = repository.saveConnection(d.url, d.token).fold(
                onSuccess = { ConnectionResult.Success("Connected. ${Format.summary(it)}") },
                onFailure = { ConnectionResult.Failure(it.message ?: "Could not connect") },
            )
            draft.update { it.copy(saving = false, result = result, token = if (result is ConnectionResult.Success) "" else it.token) }
        }
    }

    /** Returns an error message to show, or null. */
    fun setTracking(on: Boolean): String? {
        if (!on) { tracking.stop(); return null }
        val error = tracking.start()
        if (error == null) repository.setTracking(true)
        return error
    }

    fun syncNow() {
        viewModelScope.launch { repository.sync() }
    }
}
