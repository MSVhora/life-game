package app.lifegame.companion.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

internal val AppTypography = Typography()

/** The big live countdown. Tabular figures keep the digits from jumping as they change. */
val CountdownStyle = TextStyle(fontSize = 52.sp, lineHeight = 60.sp, fontWeight = FontWeight.Bold, fontFeatureSettings = "tnum")

/** Mid-size numbers inside cards (minutes left, elapsed time). */
val MetricStyle = TextStyle(fontSize = 34.sp, lineHeight = 40.sp, fontWeight = FontWeight.SemiBold, fontFeatureSettings = "tnum")
