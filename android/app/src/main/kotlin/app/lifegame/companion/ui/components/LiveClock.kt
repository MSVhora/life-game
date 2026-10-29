package app.lifegame.companion.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.produceState
import kotlinx.coroutines.delay

/** The current time in ms, refreshed every [intervalMs]. Read it only where it is shown, so only that part redraws. */
@Composable
fun rememberNowMs(intervalMs: Long = 1_000): State<Long> =
    produceState(initialValue = System.currentTimeMillis(), intervalMs) {
        while (true) {
            delay(intervalMs)
            value = System.currentTimeMillis()
        }
    }
