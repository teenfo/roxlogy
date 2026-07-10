package app.roxlogy.android.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// Roxlogy 브랜드 팔레트 — 웹(web/app/globals.css)과 1:1. 다크 단일 테마.
val RoxBackground = Color(0xFF141414) // Black
val RoxSurface = Color(0xFF1E1E1E)    // Coal
val RoxForeground = Color(0xFFF4F4F2) // Chalk
val RoxMuted = Color(0xFF9A9A96)      // Grey
val RoxAccent = Color(0xFFFFD500)     // Race Yellow — CTA·강조 한정
val RoxTrack = Color(0xFF2D7DFF)      // Track Blue — 런/페이스
val RoxError = Color(0xFFFF6B6B)

private val RoxColorScheme = darkColorScheme(
    primary = RoxAccent,
    onPrimary = RoxBackground,
    secondary = RoxTrack,
    onSecondary = RoxForeground,
    tertiary = RoxTrack,
    background = RoxBackground,
    onBackground = RoxForeground,
    surface = RoxSurface,
    onSurface = RoxForeground,
    surfaceVariant = RoxSurface,
    onSurfaceVariant = RoxMuted,
    outline = RoxMuted,
    outlineVariant = Color(0x33F4F4F2),
    error = RoxError,
    onError = RoxBackground,
)

private val RoxTypography = Typography(
    headlineMedium = TextStyle(fontWeight = FontWeight.Black, fontSize = 26.sp, letterSpacing = 0.5.sp),
    titleLarge = TextStyle(fontWeight = FontWeight.Bold, fontSize = 20.sp),
    titleMedium = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 16.sp),
    bodyLarge = TextStyle(fontWeight = FontWeight.Normal, fontSize = 15.sp),
    bodyMedium = TextStyle(fontWeight = FontWeight.Normal, fontSize = 14.sp),
    labelLarge = TextStyle(fontWeight = FontWeight.Bold, fontSize = 14.sp, letterSpacing = 0.3.sp),
    labelSmall = TextStyle(fontWeight = FontWeight.Medium, fontSize = 12.sp),
)

private val RoxShapes = Shapes(
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(10.dp),
    large = RoundedCornerShape(14.dp),
)

@Composable
fun RoxlogyTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = RoxColorScheme,
        typography = RoxTypography,
        shapes = RoxShapes,
        content = content,
    )
}
