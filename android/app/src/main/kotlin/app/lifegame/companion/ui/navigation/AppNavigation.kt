package app.lifegame.companion.ui.navigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import app.lifegame.companion.di.AppContainer
import app.lifegame.companion.ui.setup.SetupRoute
import app.lifegame.companion.ui.setup.SetupViewModel
import app.lifegame.companion.ui.today.TodayRoute
import app.lifegame.companion.ui.today.TodayViewModel

private enum class Tab(val label: String, val icon: ImageVector) {
    TODAY("Today", Icons.Filled.Home),
    SETUP("Setup", Icons.Filled.Settings),
}

/** Bottom navigation between the two screens. Two destinations do not need a navigation library. */
@Composable
fun AppNavigation(container: AppContainer, versionName: String) {
    var tab by rememberSaveable { mutableStateOf(if (container.repository.state.value.configured) Tab.TODAY else Tab.SETUP) }
    val snackbar = remember { SnackbarHostState() }

    val today: TodayViewModel = viewModel(factory = viewModelFactory { initializer { TodayViewModel(container.repository) } })
    val setup: SetupViewModel = viewModel(
        factory = viewModelFactory { initializer { SetupViewModel(container.repository, container.permissions, container.tracking, versionName) } },
    )

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            NavigationBar {
                Tab.entries.forEach { t ->
                    NavigationBarItem(
                        selected = tab == t,
                        onClick = { tab = t },
                        icon = { Icon(t.icon, contentDescription = null) },
                        label = { Text(t.label) },
                    )
                }
            }
        },
    ) { padding ->
        // The outer Scaffold already accounts for the system bars; tell the screens so they do not add them twice.
        Box(Modifier.padding(padding).consumeWindowInsets(padding)) {
            when (tab) {
                Tab.TODAY -> TodayRoute(today, snackbar, onOpenSetup = { tab = Tab.SETUP })
                Tab.SETUP -> SetupRoute(setup, container.permissions, snackbar)
            }
        }
    }
}
