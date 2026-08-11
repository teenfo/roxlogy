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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CircularProgressIndicator
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
import app.roxlogy.wear.service.SimSessionService
import app.roxlogy.wear.store.WearStore
import app.roxlogy.wear.sync.WearDataSender
import app.roxlogy.wear.ui.theme.Bad
import app.roxlogy.wear.ui.theme.Good
import app.roxlogy.wear.ui.theme.MutedText
import app.roxlogy.wear.ui.theme.RaceYellow
import app.roxlogy.wear.ui.theme.SurfaceHi
import kotlinx.coroutines.delay
import java.time.Instant
import java.util.UUID

private fun fmtT(ms: Long): String {
    val t = (ms / 1000).coerceAtLeast(0)
    return "%d:%02d".format(t / 60, t % 60)
}

/** 시안 밴드 셀 — 값 + 라벨 세로 (에르그 하단 3열용). */
@Composable
private fun BandCell(value: String, sub: String, valueColor: Color = Color.White, modifier: Modifier = Modifier) {
    Column(modifier = modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = valueColor)
        Text(sub, fontSize = 9.sp, color = MutedText)
    }
}

/**
 * 에르그 단독 기록 (시안 v0.6.0 흐름).
 * 기기 선택(SkiErg/RowErg/기기 없이 시간만) → 스캔(중지 가능) → 실패(주변 PM5 목록에서
 * 선택 연결) → 대기(핸들 당기면 자동 시작) → 기록(거리 주 지표 + 3열 밴드) → 완료 → 전송.
 * "기기 없이 시간만"은 PM5 없이 랩·시간만 기록해 세션으로 전송한다.
 */
@Composable
fun ErgScreen(ble: Pm5BleClient, sender: WearDataSender, ensureBle: ((() -> Unit) -> Unit)) {
    val context = LocalContext.current
    var machine by remember { mutableStateOf<String?>(null) } // "ski" | "row" | "none"
    var connected by remember { mutableStateOf(false) }
    var scanning by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    var latest by remember { mutableStateOf<ErgSample?>(null) }
    var phase by remember { mutableStateOf("idle") } // idle | running | done | sent
    var startMs by remember { mutableStateOf(0L) }
    var startIso by remember { mutableStateOf("") }
    var nowMs by remember { mutableStateOf(0L) }
    var laps by remember { mutableStateOf(listOf<Long>()) } // 무기기 모드 랩 경과(ms)
    var finalSamples by remember { mutableStateOf<List<ErgSample>>(emptyList()) }
    var finalStrokes by remember { mutableStateOf<List<app.roxlogy.shared.ingest.ErgStroke>>(emptyList()) }
    var finalSplits by remember { mutableStateOf<List<app.roxlogy.shared.ingest.ErgSplit>>(emptyList()) }
    var finalCurves by remember { mutableStateOf<List<app.roxlogy.shared.ingest.ErgForceCurve>>(emptyList()) }
    val vibrator = remember { context.getSystemService(Vibrator::class.java) }
    val noDevice = machine == "none"

    fun buzz(ms: Long) {
        if (WearStore.hapticEnabled(context)) {
            vibrator?.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE))
        }
    }

    fun beginRecording() {
        ble.resetSamples() // 워밍업 샘플 제거
        startMs = System.currentTimeMillis()
        nowMs = startMs
        startIso = Instant.now().toString()
        laps = emptyList()
        phase = "running"
        buzz(60)
    }

    fun connect(preferMac: String?) {
        ensureBle {
            scanning = true
            failed = false
            ble.start(object : Pm5BleClient.Listener {
                override fun onConnected() {
                    connected = true; scanning = false; failed = false
                    machine?.takeIf { it != "none" }?.let { m ->
                        ble.deviceAddress()?.let { WearStore.setPm5Mac(context, m, it) }
                    }
                }
                override fun onDisconnected() { connected = false }
                override fun onSamples(samples: List<ErgSample>) {
                    val s = samples.lastOrNull()
                    latest = s
                    // 시안: 핸들을 당기면 자동으로 기록 시작 (대기 화면에서 출력·spm 감지)
                    if (phase == "idle" && connected && s != null &&
                        ((s.watts ?: 0) >= AUTO_START_WATTS || (s.spm ?: 0) > 0)
                    ) beginRecording()
                }
                override fun onFailed(reason: String) { scanning = false; connected = false; failed = true }
            }, preferMac = preferMac)
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            ble.stop()
            SimSessionService.stop(context)
        }
    }

    // 화면 꺼짐 대응 — 연결·기록 중엔 포그라운드 서비스로 BLE 수집 유지 (시뮬과 동일).
    // 서비스 없이는 Wear OS 절전이 화면 꺼짐 직후 백그라운드 BLE 를 끊는다.
    // 기록 중엔 워치페이스 칩에 경과 시간을 스톱워치로 표시한다 (타이머 앱과 동일).
    LaunchedEffect(phase, connected, scanning) {
        val label = when (machine) {
            "ski" -> "스키에르그"
            "row" -> "로우에르그"
            else -> "에르그"
        }
        when {
            phase == "running" -> SimSessionService.start(context, label, startMs)
            connected -> SimSessionService.start(context, "$label 대기")
            scanning -> SimSessionService.start(context, "PM5 연결 중")
            else -> SimSessionService.stop(context)
        }
    }

    // 설정 '화면 항상 켜기' 존중 (시뮬과 동일)
    val activity = context as? androidx.activity.ComponentActivity
    DisposableEffect(Unit) {
        if (WearStore.screenOnEnabled(context)) {
            activity?.window?.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
        onDispose {
            activity?.window?.clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    LaunchedEffect(phase) {
        while (phase == "running") {
            nowMs = System.currentTimeMillis()
            delay(500)
        }
    }

    fun send() {
        val key = machine ?: return
        val elapsed = nowMs - startMs
        val segments = if (key == "none") {
            // 무기기 모드 — 랩이 있으면 랩별 세그먼트, 없으면 단일 세그먼트 (머신·erg 없음)
            val marks = (laps + elapsed).distinct().sorted()
            var prev = 0L
            marks.map { t ->
                RecordedSegment(kind = "station", splitTimeMs = t - prev).also { prev = t }
            }
        } else {
            val station = Stations.byKey(key) ?: return
            listOf(
                RecordedSegment(
                    kind = "station",
                    splitTimeMs = elapsed,
                    exerciseId = station.exerciseId,
                    machineType = key,
                    ergSamples = finalSamples,
                    ergStrokes = finalStrokes,
                    ergSplits = finalSplits,
                    ergForceCurves = finalCurves,
                ),
            )
        }
        val req = SessionAssembler.assemble(
            sessionId = UUID.randomUUID().toString(),
            startedAtIso = startIso,
            clientUpdatedAtIso = Instant.now().toString(),
            endedAtIso = Instant.now().toString(),
            segments = segments,
        )
        val payload = IngestJson.encode(req)
        sender.sendRaw(req.session.id, payload, req.session.client_updated_at)
        WearStore.addSession(
            context,
            StoredSession(
                id = req.session.id, createdAtMs = System.currentTimeMillis(),
                totalMs = elapsed, clientUpdatedAt = req.session.client_updated_at,
                payloadJson = payload, sent = true,
            ),
        )
        phase = "sent"
        buzz(120)
    }

    Scaffold(timeText = { TimeText() }) {
        Column(
            modifier = Modifier.fillMaxSize().padding(horizontal = 26.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // 헤더는 대기 단계에서만 — 기록 중엔 큰 타이머와 시계(TimeText) 겹침 방지
            if (phase == "idle") {
                Text("에르그", fontSize = 12.sp, color = RaceYellow, fontWeight = FontWeight.Bold)
            }
            when (phase) {
                "idle" -> when {
                    machine == null -> DevicePicker(
                        onPick = { key ->
                            machine = key
                            if (key == "none") beginRecording()
                            else connect(WearStore.pm5Mac(context, key))
                        },
                    )
                    scanning -> {
                        CircularProgressIndicator(Modifier.size(30.dp), indicatorColor = RaceYellow)
                        Text("연결 중…", fontSize = 12.sp, color = RaceYellow, fontWeight = FontWeight.Bold)
                        Text("PM5에서 Menu → Connect 화면을 열어두세요", fontSize = 9.sp, color = MutedText, textAlign = TextAlign.Center)
                        Text("최대 30초까지 검색합니다", fontSize = 10.sp, color = MutedText)
                        PrimaryActionChip("검색 중지") { ble.cancelScan(); scanning = false; failed = true }
                    }
                    failed -> {
                        StatusDot(Bad, "연결 안 됨")
                        val remembered = machine?.takeIf { it != "none" }?.let { WearStore.pm5Mac(context, it) }
                        val nearby = ble.nearbyPm5(remembered)
                        Text(
                            if (nearby.isEmpty()) "주변에서 PM5를 찾지 못했습니다"
                            else "주변 PM5 — 탭하면 연결",
                            fontSize = 9.sp, color = MutedText,
                        )
                        // 주변 PM5 목록: 이름 + RSSI, 기억한 기기 태그. 탭 = 해당 기기로 연결
                        nearby.take(3).forEach { pm ->
                            Row(
                                modifier = Modifier.fillMaxWidth(0.9f),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                CompactChip(
                                    onClick = { connect(pm.mac) },
                                    modifier = Modifier.weight(1f),
                                    colors = ChipDefaults.chipColors(backgroundColor = SurfaceHi, contentColor = Color.White),
                                    label = {
                                        Text(
                                            pm.name + if (pm.remembered) " · 기억함" else "",
                                            fontSize = 11.sp, maxLines = 1,
                                        )
                                    },
                                )
                                Spacer(Modifier.width(5.dp))
                                Text("${pm.rssi} dBm", fontSize = 9.sp, color = MutedText)
                            }
                        }
                        PrimaryActionChip("다시 연결") { connect(remembered) }
                        SubtleChip("기기 변경") { machine = null; ble.stop(); connected = false; failed = false }
                    }
                    connected -> {
                        StatusDot(Good, "연결됨 ✓")
                        Text(ble.deviceName() ?: "", fontSize = 9.sp, color = MutedText)
                        // 라이브 미리보기 3열 (0m / 0W / 0spm)
                        Row(
                            modifier = Modifier.fillMaxWidth(0.85f).height(IntrinsicSize.Min),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            BandCell("${latest?.dist?.toInt() ?: 0}m", "거리", modifier = Modifier.weight(1f))
                            Box(Modifier.width(1.dp).fillMaxHeight().background(SurfaceHi))
                            BandCell("${latest?.watts ?: 0}W", "출력", RaceYellow, Modifier.weight(1f))
                            Box(Modifier.width(1.dp).fillMaxHeight().background(SurfaceHi))
                            BandCell("${latest?.spm ?: 0}", "spm", modifier = Modifier.weight(1f))
                        }
                        Text("핸들을 당기면 자동으로 기록 시작", fontSize = 10.sp, color = MutedText)
                        PrimaryActionChip("시작") { beginRecording() }
                        SubtleChip("기기 변경") { machine = null; ble.stop(); connected = false }
                    }
                    else -> {
                        // 스캔도 실패도 아닌 대기(취소 직후 등)
                        StatusDot(Bad, "연결 안 됨")
                        PrimaryActionChip("다시 연결") {
                            connect(machine?.takeIf { it != "none" }?.let { WearStore.pm5Mac(context, it) })
                        }
                        SubtleChip("기기 변경") { machine = null }
                    }
                }
                "running" -> {
                    Text(
                        when (machine) { "ski" -> "SkiErg"; "row" -> "RowErg"; else -> "시간 기록" },
                        fontSize = 11.sp, color = MutedText,
                    )
                    if (noDevice) {
                        // 무기기: 시간이 주 지표 + 랩
                        Text(fmtT(nowMs - startMs), fontSize = 40.sp, fontWeight = FontWeight.Bold)
                        Text(
                            if (laps.isEmpty()) "랩 없음" else "랩 ${laps.size} · 마지막 ${fmtT(laps.last() - (laps.getOrNull(laps.size - 2) ?: 0L))}",
                            fontSize = 10.sp, color = MutedText,
                        )
                        PrimaryActionChip("랩") { laps = laps + (System.currentTimeMillis() - startMs); buzz(60) }
                        SubtleChip("종료") {
                            nowMs = System.currentTimeMillis()
                            phase = "done"
                            buzz(200)
                        }
                    } else {
                        // 시안: 거리 주 지표(대형) + 하단 3열 밴드(시간/출력/페이스)
                        Row(verticalAlignment = Alignment.Bottom) {
                            Text(
                                "${latest?.dist?.toInt() ?: 0}",
                                fontSize = 40.sp, fontWeight = FontWeight.Bold,
                            )
                            Text(" m", fontSize = 14.sp, color = MutedText, modifier = Modifier.padding(bottom = 5.dp))
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth(0.9f).height(IntrinsicSize.Min),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            BandCell(fmtT(nowMs - startMs), "시간", modifier = Modifier.weight(1f))
                            Box(Modifier.width(1.dp).fillMaxHeight().background(SurfaceHi))
                            BandCell("${latest?.watts ?: 0}W", "${latest?.spm ?: 0}spm", RaceYellow, Modifier.weight(1f))
                            Box(Modifier.width(1.dp).fillMaxHeight().background(SurfaceHi))
                            BandCell(
                                latest?.pace?.let { fmtT((it * 1000).toLong()) } ?: "--",
                                "/500m", modifier = Modifier.weight(1f),
                            )
                        }
                        if (!connected) Text("연결 끊김 — 재연결 대기", fontSize = 9.sp, color = MutedText)
                        PrimaryActionChip("종료") {
                            nowMs = System.currentTimeMillis()
                            finalSamples = ble.snapshot()
                            finalStrokes = ble.strokeSnapshot()
                            finalSplits = ble.splitSnapshot()
                            finalCurves = ble.forceCurveSnapshot()
                            phase = "done"
                            buzz(200)
                        }
                    }
                }
                "done" -> {
                    if (noDevice) {
                        Text(fmtT(nowMs - startMs), fontSize = 30.sp, fontWeight = FontWeight.Bold)
                        Text(
                            if (laps.isEmpty()) "랩 없음" else "랩 ${laps.size}개",
                            fontSize = 11.sp, color = MutedText,
                        )
                    } else {
                        Text(
                            "${finalSamples.lastOrNull()?.dist?.toInt() ?: 0}m · ${fmtT(nowMs - startMs)}",
                            fontSize = 20.sp, fontWeight = FontWeight.Bold,
                        )
                        val avgW = finalSamples.mapNotNull { it.watts }.let { if (it.isEmpty()) null else it.average().toInt() }
                        val avgPace = finalSamples.mapNotNull { it.pace }.filter { it > 0 }
                            .let { if (it.isEmpty()) null else it.average() }
                        Row(
                            modifier = Modifier.fillMaxWidth(0.8f).height(IntrinsicSize.Min),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            BandCell("${avgW ?: 0}W", "평균 출력", RaceYellow, Modifier.weight(1f))
                            Box(Modifier.width(1.dp).fillMaxHeight().background(SurfaceHi))
                            BandCell(
                                avgPace?.let { fmtT((it * 1000).toLong()) } ?: "--",
                                "평균 /500m", modifier = Modifier.weight(1f),
                            )
                        }
                        Text(
                            "샘플 ${finalSamples.size} · 스트로크 ${finalStrokes.size} · 곡선 ${finalCurves.size}",
                            fontSize = 9.sp, color = MutedText,
                        )
                        // 힘 곡선 0건 진단 — 특성별 수신 수·청크·구독 포기 (원인 확정 후 제거)
                        Text(
                            ble.diag(),
                            fontSize = 8.sp, color = MutedText,
                            textAlign = TextAlign.Center, maxLines = 3,
                        )
                    }
                    PrimaryActionChip("전송") { send() }
                    SubtleChip("버리기") { phase = "idle"; latest = null; laps = emptyList() }
                }
                "sent" -> {
                    Text("전송됨 ✓", fontSize = 15.sp, color = RaceYellow, fontWeight = FontWeight.Bold)
                    Text(
                        if (noDevice) "${fmtT(nowMs - startMs)} · 랩 ${laps.size}개"
                        else "${finalSamples.lastOrNull()?.dist?.toInt() ?: 0}m · ${fmtT(nowMs - startMs)}",
                        fontSize = 11.sp, color = MutedText,
                    )
                    Text("폰 세션 목록에서 곡선·지표 확인", fontSize = 10.sp, color = MutedText, textAlign = TextAlign.Center)
                    PrimaryActionChip("새 기록") {
                        phase = "idle"; latest = null; laps = emptyList()
                        finalSamples = emptyList(); finalStrokes = emptyList()
                        finalSplits = emptyList(); finalCurves = emptyList()
                    }
                }
            }
        }
    }
}

/** 기기 선택 — 시안 리스트형 3항목 (아이콘 + 이름 + 서브). */
@Composable
private fun DevicePicker(onPick: (String) -> Unit) {
    @Composable
    fun row(glyph: String, title: String, sub: String, key: String) {
        Chip(
            onClick = { onPick(key) },
            modifier = Modifier.fillMaxWidth(),
            colors = ChipDefaults.secondaryChipColors(backgroundColor = SurfaceHi),
            icon = { Text(glyph, fontSize = 14.sp, color = if (key == "none") MutedText else RaceYellow) },
            label = { Text(title, fontSize = 13.sp, fontWeight = FontWeight.Bold) },
            secondaryLabel = { Text(sub, fontSize = 9.sp) },
        )
    }
    row("↑", "SkiErg", "PM5 연결 기록", "ski")
    row("↔", "RowErg", "PM5 연결 기록", "row")
    row("◷", "기기 없이 시간만", "PM5 없이 랩·시간 기록", "none")
    Text(
        "PM5에서 Menu → Connect 를 연 뒤 종목을 탭하세요",
        fontSize = 9.sp, color = MutedText, textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth(0.85f),
    )
}

/** 상태점 + 라벨 (시안 ● 연결). */
@Composable
private fun StatusDot(color: Color, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(7.dp).clip(CircleShape).background(color))
        Spacer(Modifier.width(5.dp))
        Text(label, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = color)
    }
}

/** 보조 칩 (SurfaceHi). */
@Composable
private fun SubtleChip(text: String, onClick: () -> Unit) {
    CompactChip(
        onClick = onClick,
        colors = ChipDefaults.chipColors(backgroundColor = SurfaceHi, contentColor = Color.White),
        label = { Text(text, fontSize = 12.sp) },
    )
}

private const val AUTO_START_WATTS = 15 // 이 출력 이상이면 "핸들을 당겼다"고 본다
