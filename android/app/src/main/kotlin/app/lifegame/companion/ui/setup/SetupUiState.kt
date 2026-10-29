package app.lifegame.companion.ui.setup

import app.lifegame.companion.system.PermissionState

/** The outcome of "Save and test", shown under the form. */
sealed interface ConnectionResult {
    data class Success(val summary: String) : ConnectionResult
    data class Failure(val reason: String) : ConnectionResult
}

data class SetupUiState(
    val urlDraft: String = "",
    val tokenDraft: String = "",
    /** A token is already stored, so the field may be left empty. */
    val tokenSaved: Boolean = false,
    val saving: Boolean = false,
    val connectionResult: ConnectionResult? = null,
    val permissions: PermissionState = PermissionState(usageAccess = false, notifications = false, batteryUnrestricted = false),
    val trackingOn: Boolean = false,
    val syncing: Boolean = false,
    val lastSyncMs: Long = 0,
    val queued: Int = 0,
    val lastUploaded: Int = 0,
    val lastError: String? = null,
    val versionName: String = "",
)
