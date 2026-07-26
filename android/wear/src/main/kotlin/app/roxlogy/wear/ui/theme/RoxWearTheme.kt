package app.roxlogy.wear.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.wear.compose.material.Colors
import androidx.wear.compose.material.MaterialTheme

// 브랜드 팔레트 (brand/roxlogy-brand-guide.html v4)
val RaceYellow = Color(0xFFFFD500)
val TrackBlue = Color(0xFF2D7DFF)
val RoxBlack = Color(0xFF141414)
val Chalk = Color(0xFFF4F4F2)
val Surface = Color(0xFF1F1F1F)
val SurfaceHi = Color(0xFF2A2A2A)
val MutedText = Color(0xFF9A9A96)
val Good = Color(0xFF35C26B)
val Bad = Color(0xFFFF6B6B)

// 시뮬 단계 배경 (러닝=블루, 스테이션=옐로, 록스존=차콜)
val RunBg = Color(0xFF0D1E3C)
val StationBg = Color(0xFF2E2700)
val RoxzoneBg = Color(0xFF33332E)

private val RoxColors = Colors(
    primary = RaceYellow,
    primaryVariant = Color(0xFFCCAA00),
    secondary = TrackBlue,
    secondaryVariant = Color(0xFF1E5CC4),
    background = RoxBlack,
    surface = Surface,
    error = Bad,
    onPrimary = Color.Black,
    onSecondary = Color.White,
    onBackground = Chalk,
    onSurface = Chalk,
    onSurfaceVariant = MutedText,
    onError = Color.Black,
)

/** 워치 전역 테마 — 브랜드 컬러를 Wear MaterialTheme 에 주입. */
@Composable
fun RoxWearTheme(content: @Composable () -> Unit) {
    MaterialTheme(colors = RoxColors, content = content)
}

/** 심박 존 컬러: <120 회색, <140 파랑, <160 초록, <175 주황, ≥175 빨강. */
fun hrZoneColor(bpm: Int): Color = when {
    bpm < 120 -> MutedText
    bpm < 140 -> TrackBlue
    bpm < 160 -> Good
    bpm < 175 -> Color(0xFFFFA726)
    else -> Bad
}
