package app.roxlogy.wear.ui

import android.os.VibrationEffect
import android.os.Vibrator
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CompactChip
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import app.roxlogy.shared.ingest.ErgSample
import app.roxlogy.shared.ingest.IngestJson
import app.roxlogy.shared.model.Stations
import app.roxlogy.shared.record.RecordedSegment
import app.roxlogy.shared.record.SessionAssembler
import app.roxlogy.shared.record.StoredSession
import app.roxlogy.wear.ble.Pm5BleClient
import app.roxlogy.wear.store.WearStore
import app.roxlogy.wear.sync.WearDataSender
import app.roxlogy.wear.ui.theme.MutedText
import app.roxlogy.wear.ui.theme.RaceYellow
import app.roxlogy.wear.ui.theme.SurfaceHi
import app.roxlogy.wear.ui.theme.TrackBlue
import kotlinx.coroutines.delay
import java.time.Instant
import java.util.UUID

private fun fmtT(ms: Long): String {
    val t = (ms / 1000).coerceAtLeast(0)
    return "%d:%02d".format(t / 60, t % 60)
}

/**
 * 에르그 단독 기록 — PM5 를 연결해 스키/로잉 워크아웃 raw 를 수집하고
 * 단일 스테이션 세션으로 서버에 전송한다 (기존 세션 파이프라인 재사용:
 * erg_samples → segment_metrics 곡선 → 웹 세션 상세 차트·PR·AI 코칭).
 */
@Composable
fun ErgScreen(ble: Pm5BleClient, sender: WearDataSender, ensureBle: ((() -> Unit) -> Unit)) {
    val context = LocalContext.current
    var machine by remember { mutableStateOf<String?>(null) } // "ski" | "row"
    var connected by remember { mutableStateOf(false) }
    var scanning by remember { mutableStateOf(false) }
    var latest by remember { mutableStateOf<ErgSample?>(null) }
    var phase by remember { mutableStateOf("idle") } // idle | running | done | sent
    var startMs by remember { mutableStateOf(0L) }
    var startIso by remember { mutableStateOf("") }
    var nowMs by remember { mutableStateOf(0L) }
    var finalSamples by remember { mutableStateOf<List<ErgSample>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    val vibrator = remember { context.getSystemService(Vibrator::class.java) }

    fun buzz(ms: Long) {
        if (WearStore.hapticEnabled(context)) {
            vibrator?.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE))
        }
    }

    fun connect() {
        ensureBle { // 권한 승인 후 스캔 시작 (호출측 런처)
            scanning = true
            error = null
            ble.start(object : Pm5BleClient.Listener {
                override fun onConnected() { connected = true; scanning = false; error = null }
                override fun onDisconnected() { connected = false }
                override fun onSamples(samples: List<ErgSample>) { latest = samples.lastOrNull() }
                override fun onFailed(reason: String) { scanning = false; connected = false; error = reason }
            })
        }
    }

    DisposableEffect(Unit) { onDispose { ble.stop() } }

    LaunchedEffect(phase) {
        while (phase == "running") {
            nowMs = System.currentTimeMillis()
            delay(500)
        }
    }

    fun send() {
        val key = machine ?: return
        val station = Stations.byKey(key) ?: return
        val seg = RecordedSegment(
            kind = "station",
            splitTimeMs = nowMs - startMs,
            exerciseId = station.exerciseId,
            machineType = key,
            ergSamples = finalSamples,
        )
        val req = SessionAssembler.assemble(
            sessionId = UUID.randomUUID().toString(),
            startedAtIso = startIso,
            clientUpdatedAtIso = Instant.now().toString(),
            endedAtIso = Instant.now().toString(),
            segments = listOf(seg),
        )
        val payload = IngestJson.encode(req)
        sender.sendRaw(req.session.id, payload, req.session.client_updated_at)
        WearStore.addSession(
            context,
            StoredSession(
                id = req.session.id, createdAtMs = System.currentTimeMillis(),
                totalMs = seg.splitTimeMs, clientUpdatedAt = req.session.client_updated_at,
                payloadJson = payload, sent = true,
            ),
        )
        phase = "sent"
        buzz(120)
    }

    Scaffold(timeText = { TimeText() }) {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("에르그", fontSize = 12.sp, color = RaceYellow, fontWeight = FontWeight.Bold)
            when (phase) {
                "idle" -> {
                    if (machine == null) {
                        Text("기기 선택", fontSize = 11.sp, color = MutedText)
                        Row {
                            CompactChip(
                                onClick = { machine = "ski"; connect() },
                                colors = ChipDefaults.chipColors(backgroundColor = SurfaceHi, contentColor = Color.White),
                                label = { Text("SkiErg", fontSize = 12.sp) },
                            )
                            Spacer(Modifier.width(6.dp))
                            CompactChip(
                                onClick = { machine = "row"; connect() },
                                colors = ChipDefaults.chipColors(backgroundColor = SurfaceHi, contentColor = Color.White),
                                label = { Text("RowErg", fontSize = 12.sp) },
                            )
                        }
                        Text("PM5 화면을 깨운 뒤 선택", fontSize = 9.sp, color = MutedText)
                    } else {
                        Text(
                            when {
                                connected -> "${if (machine == "ski") "SkiErg" else "RowErg"} 연결됨 ✓"
                                scanning -> "연결 중…"
                                else -> "연결 안 됨"
                            },
                            fontSize = 11.sp,
                            color = if (connected) TrackBlue else MutedText,
                        )
                        if (!connected && !scanning) {
                            error?.let {
                                Text(
                                    it, fontSize = 9.sp, color = MutedText,
                                    textAlign = TextAlign.Center,
                                    modifier = Modifier.fillMaxWidth(0.85f),
                                )
                            }
                        }
                        if (connected) {
                            latest?.let { Text("${it.watts ?: 0}W · ${it.spm ?: 0}spm", fontSize = 11.sp, color = MutedText) }
                            PrimaryActionChip("시작") {
                                ble.resetSamples() // 워밍업 샘플 제거
                                startMs = System.currentTimeMillis()
                                nowMs = startMs
                                startIso = Instant.now().toString()
                                phase = "running"
                                buzz(60)
                            }
                        } else if (!scanning) {
                            PrimaryActionChip("다시 연결") { connect() }
                        }
                        CompactChip(
                            onClick = { machine = null; ble.stop(); connected = false },
                            colors = ChipDefaults.chipColors(backgroundColor = SurfaceHi, contentColor = Color.White),
                            label = { Text("기기 변경", fontSize = 10.sp) },
                        )
                    }
                }
                "running" -> {
                    Text(if (machine == "ski") "SkiErg" else "RowErg", fontSize = 11.sp, color = MutedText)
                    // T자 3분할: 타이머 전폭 + 좌 파워 / 우 거리·페이스
                    Text(fmtT(nowMs - startMs), fontSize = 30.sp, fontWeight = FontWeight.Bold)
                    Row(
                        modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Min),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        MetricCell(
                            value = "${latest?.watts ?: 0}W",
                            valueColor = RaceYellow,
                            sub = "${latest?.spm ?: 0}spm",
                            modifier = Modifier.weight(1f),
                        )
                        Box(Modifier.width(1.dp).fillMaxHeight().background(SurfaceHi))
                        MetricCell(
                            value = "${latest?.dist?.toInt() ?: 0}m",
                            valueColor = Color.White,
                            sub = latest?.pace?.let { p -> "${fmtT((p * 1000).toLong())}/500m" } ?: "페이스 --",
                            modifier = Modifier.weight(1f),
                        )
                    }
                    if (!connected) Text("연결 끊김 — 재연결 대기", fontSize = 9.sp, color = MutedText)
                    PrimaryActionChip("종료") {
                        nowMs = System.currentTimeMillis()
                        finalSamples = ble.snapshot()
                        phase = "done"
                        buzz(200)
                    }
                }
                "done" -> {
                    Text(fmtT(nowMs - startMs), fontSize = 26.sp, fontWeight = FontWeight.Bold)
                    val avgW = finalSamples.mapNotNull { it.watts }.let { if (it.isEmpty()) null else it.average().toInt() }
                    Text(
                        "${finalSamples.size} 샘플" + (avgW?.let { " · 평균 ${it}W" } ?: ""),
                        fontSize = 11.sp, color = MutedText,
                    )
                    PrimaryActionChip("전송") { send() }
                    CompactChip(
                        onClick = { phase = "idle"; latest = null },
                        colors = ChipDefaults.chipColors(backgroundColor = SurfaceHi, contentColor = Color.White),
                        label = { Text("버리기", fontSize = 12.sp) },
                    )
                }
                "sent" -> {
                    Text("전송됨 ✓", fontSize = 15.sp, color = RaceYellow, fontWeight = FontWeight.Bold)
                    Text("세션 목록에서 곡선·지표 확인", fontSize = 10.sp, color = MutedText, textAlign = TextAlign.Center)
                    PrimaryActionChip("새 기록") { phase = "idle"; latest = null; finalSamples = emptyList() }
                }
            }
        }
    }
}
