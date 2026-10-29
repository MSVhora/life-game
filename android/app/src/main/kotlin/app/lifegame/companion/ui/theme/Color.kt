package app.lifegame.companion.ui.theme

import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color

// Brand: the same indigo as the web app, so the two feel like one product.
internal val LightColors = lightColorScheme(
    primary = Color(0xFF4F46E5),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFE0E7FF),
    onPrimaryContainer = Color(0xFF1E1B4B),
    secondary = Color(0xFF475569),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFE2E8F0),
    onSecondaryContainer = Color(0xFF0F172A),
    tertiary = Color(0xFF15803D),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFDCFCE7),
    onTertiaryContainer = Color(0xFF052E16),
    error = Color(0xFFB91C1C),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFEE2E2),
    onErrorContainer = Color(0xFF450A0A),
    background = Color(0xFFF6F7FB),
    onBackground = Color(0xFF1B1F2A),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF1B1F2A),
    surfaceVariant = Color(0xFFEDEFF6),
    onSurfaceVariant = Color(0xFF5B6275),
    outline = Color(0xFFC5CAD8),
    outlineVariant = Color(0xFFE4E7EF),
)

internal val DarkColors = darkColorScheme(
    primary = Color(0xFFA5A0FF),
    onPrimary = Color(0xFF1B1760),
    primaryContainer = Color(0xFF3730A3),
    onPrimaryContainer = Color(0xFFE0E7FF),
    secondary = Color(0xFFB4BDD0),
    onSecondary = Color(0xFF1E2433),
    secondaryContainer = Color(0xFF2E3550),
    onSecondaryContainer = Color(0xFFE2E8F0),
    tertiary = Color(0xFF4ADE80),
    onTertiary = Color(0xFF052E16),
    tertiaryContainer = Color(0xFF14532D),
    onTertiaryContainer = Color(0xFFDCFCE7),
    error = Color(0xFFF87171),
    onError = Color(0xFF450A0A),
    errorContainer = Color(0xFF7F1D1D),
    onErrorContainer = Color(0xFFFEE2E2),
    background = Color(0xFF0F1220),
    onBackground = Color(0xFFE8EAF3),
    surface = Color(0xFF181C2E),
    onSurface = Color(0xFFE8EAF3),
    surfaceVariant = Color(0xFF262B45),
    onSurfaceVariant = Color(0xFF9AA3B8),
    outline = Color(0xFF4A5170),
    outlineVariant = Color(0xFF2A3050),
)

/** Colours for states the Material scheme has no name for: "careful, not an error". */
@Immutable
data class StatusColors(val warning: Color, val warningContainer: Color, val onWarningContainer: Color)

internal val LightStatusColors = StatusColors(Color(0xFFB45309), Color(0xFFFEF3C7), Color(0xFF451A03))
internal val DarkStatusColors = StatusColors(Color(0xFFFBBF24), Color(0xFF3A2C0B), Color(0xFFFEF3C7))
