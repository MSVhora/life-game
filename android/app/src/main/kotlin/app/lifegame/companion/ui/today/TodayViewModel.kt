package app.lifegame.companion.ui.today

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.lifegame.core.model.TimerKind
import app.lifegame.core.repository.LifeGameRepository
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class TodayViewModel(private val repository: LifeGameRepository) : ViewModel() {
    val uiState: StateFlow<TodayUiState> = repository.state
        .map(TodayUiState::from)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), TodayUiState.from(repository.state.value))

    private val _messages = Channel<String>(Channel.BUFFERED)

    /** One-off messages for a snackbar (results of taps). */
    val messages: Flow<String> = _messages.receiveAsFlow()

    fun refresh() {
        viewModelScope.launch { repository.sync() }
    }

    fun wake() = report { repository.wake().getOrThrow() }

    fun startTimer() = report {
        val kind = repository.state.value.timerKind // the source of truth, not the screen's copy
        repository.startTimer(kind).getOrThrow()
        "${kind.label} timer started"
    }

    fun stopTimer() = report {
        repository.stopTimer().getOrThrow()
        "Timer stopped"
    }

    fun selectTimerKind(kind: TimerKind) = repository.setTimerKind(kind)

    private fun report(block: suspend () -> String) {
        viewModelScope.launch {
            val message = runCatching { block() }.getOrElse { it.message ?: "Something went wrong" }
            _messages.send(message)
        }
    }
}
