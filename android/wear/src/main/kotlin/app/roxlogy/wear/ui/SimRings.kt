package app.roxlogy.wear.ui

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke

// Roxlogy 로고 두 링: 바깥 옐로 8세그먼트(스테이션) + 안쪽 블루 트랙(러닝).
private val Yellow = Color(0xFFFFD500)
private val YellowDim = Color(0xFF2B2A12)
private val YellowActive = Color(0xFF8A7A1E)
private val Blue = Color(0xFF2D7DFF)
private val BlueDim = Color(0xFF14213F)
private val BlueHead = Color(0xFF7FB0FF)

/**
 * 두 링 배경. stationDone=점등된 바깥 세그먼트 수(0..8), activeStation=현재 진행 스테이션 서수
 * (0..7, 없으면 -1), runProgress=안쪽 트랙 채움(0..1, 1km=한 바퀴).
 */
@Composable
fun SimRings(
    stationDone: Int,
    activeStation: Int,
    runProgress: Float,
    modifier: Modifier = Modifier,
) {
    Canvas(modifier) {
        val w = size.minDimension
        val cx = size.width / 2f
        val cy = size.height / 2f

        // 바깥 8세그먼트
        val outerStroke = w * 0.055f
        val rO = w / 2f - outerStroke
        val seg = 360f / 8f
        val gap = 7f
        for (i in 0 until 8) {
            val start = -90f + i * seg + gap / 2f
            val sweep = seg - gap
            val col = when {
                i < stationDone -> Yellow
                i == activeStation -> YellowActive
                else -> YellowDim
            }
            drawArc(
                color = col,
                startAngle = start,
                sweepAngle = sweep,
                useCenter = false,
                topLeft = Offset(cx - rO, cy - rO),
                size = Size(rO * 2f, rO * 2f),
                style = Stroke(width = outerStroke, cap = StrokeCap.Butt),
            )
        }

        // 안쪽 트랙 링
        val innerStroke = w * 0.03f
        val rI = rO - outerStroke * 0.6f - innerStroke * 1.8f
        drawArc(
            color = BlueDim,
            startAngle = 0f,
            sweepAngle = 360f,
            useCenter = false,
            topLeft = Offset(cx - rI, cy - rI),
            size = Size(rI * 2f, rI * 2f),
            style = Stroke(width = innerStroke, cap = StrokeCap.Round),
        )
        val p = runProgress.coerceIn(0f, 1f)
        if (p > 0f) {
            drawArc(
                color = Blue,
                startAngle = -90f,
                sweepAngle = 360f * p,
                useCenter = false,
                topLeft = Offset(cx - rI, cy - rI),
                size = Size(rI * 2f, rI * 2f),
                style = Stroke(width = innerStroke, cap = StrokeCap.Round),
            )
        }
    }
}
