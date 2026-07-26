package app.roxlogy.wear

import android.Manifest
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CompactChip
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import app.roxlogy.shared.ingest.ErgSample
import app.roxlogy.shared.ingest.IngestJson
import app.roxlogy.shared.record.SessionAssembler
import app.roxlogy.shared.record.SimSnapshot
import app.roxlogy.shared.record.StoredSession
import app.roxlogy.shared.record.WearStoreCodec
import app.roxlogy.shared.sim.GoalPlan
import app.roxlogy.shared.sim.SimEngine
import app.roxlogy.wear.ble.Pm5BleClient
import app.roxlogy.wear.run.RunDistanceTracker
import app.roxlogy.wear.store.WearStore
import app.roxlogy.wear.sync.WearDataSender
import app.roxlogy.wear.sync.WearGoal
import app.roxlogy.wear.ui.SimRings
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.time.Instant
import java.util.Date
import java.util.Locale
import java.util.UUID

/**
 * 워치 하이록스 시뮬레이션 레코더.
 * 메뉴(시뮬·보관함·설정) → 레이스 시뮬 24슬롯 기록 → 세션 조립 → Data Layer 폰 전송.
 * 기록 안정성: 일시정지/재개·랩 취소·진행 스냅샷 영속화(크래시 복구)·보관함 재전송.
 * 배경 = 로고 두 링(바깥 8세그먼트=스테이션 완료, 안쪽 트랙=1km 러닝 진행).
 * PM5(에르그)는 스키/로잉 스테이션에서 raw 보강(선택).
 */
class MainActivity : ComponentActivity() {
    private lateinit var ble: Pm5BleClient
    private lateinit var sender: WearDataSender

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ble = Pm5BleClient(this)
        sender = WearDataSender(this)
        setContent { MaterialTheme { RootApp(ble, sender) } }
    }

    override fun onDestroy() {
        ble.stop()
        super.onDestroy()
    }
}

private enum class AppPhase { IDLE, RUNNING, DONE, SENT }
private enum class Screen { MENU, SIM, ARCHIVE, SETTINGS }

// 1차 러닝 진행 시각 페이서(실거리 소스는 Health Services 후속 커밋). 5:00/km.
private const val NOMINAL_RUN_MS = 300_000L

private val STATION_LABEL = mapOf(
    "ski" to "SkiErg", "sledpush" to "Sled Push", "sledpull" to "Sled Pull",
    "burpee" to "Burpee BJ", "row" to "Rowing", "farmers" to "Farmers",
    "lunges" to "Lunges", "wallballs" to "Wall Balls",
)

private fun fmt(ms: Long): String {
    val t = (ms / 1000).coerceAtLeast(0)
    return "%d:%02d".format(t / 60, t % 60)
}

// 단계 색 — 브랜드: 러닝=트랙 블루, 스테이션=레이스 옐로, 록스존=초크(회백).
// 중앙 배경·헤더·버튼을 단계별로 다르게 칠해 "지금 뭘 하는 중인지" 즉시 인지되게 한다.
private val RunBlue = Color(0xFF2D7DFF)
private val RaceYellow = Color(0xFFFFD500)
private val Chalk = Color(0xFFF4F4F2)
private val RunBg = Color(0xFF0D1E3C)      // 러닝: 짙은 블루
private val StationBg = Color(0xFF2E2700)  // 스테이션: 짙은 옐로
private val RoxzoneBg = Color(0xFF33332E)  // 록스존: 차콜 그레이
private val NeutralChip = Color(0xFF3A3A3A)

/** 알약형 액션 버튼 — 원형 Button은 한글 라벨이 잘려서 CompactChip 사용. */
@Composable
private fun ActionChip(text: String, bg: Color, fg: Color, onClick: () -> Unit) {
    CompactChip(
        onClick = onClick,
        colors = ChipDefaults.chipColors(backgroundColor = bg, contentColor = fg),
        label = { Text(text, fontSize = 13.sp) },
    )
}

// 목표 대비 diff: 음수=앞섬(−, 초록), 양수=뒤처짐(+, 빨강).
private fun fmtDiff(ms: Long): String {
    val a = Math.abs(ms) / 1000
    return (if (ms <= 0) "-" else "+") + "%d:%02d".format(a / 60, a % 60)
}

@Composable
private fun DiffBadge(diffMs: Long?) {
    if (diffMs == null) return
    Text(
        "목표 " + fmtDiff(diffMs),
        fontSize = 11.sp,
        color = if (diffMs <= 0) Color(0xFF35C26B) else Color(0xFFFF6B6B),
    )
}

private fun blePermissions(): Array<String> =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
    } else {
        arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
    }

// ---------------------------------------------------------------- 루트: 화면 전환
@Composable
fun RootApp(ble: Pm5BleClient, sender: WearDataSender) {
    val context = LocalContext.current
    var screen by remember { mutableStateOf(Screen.MENU) }
    var resume by remember { mutableStateOf<SimSnapshot?>(null) }
    var simKey by remember { mutableStateOf(0) } // 새 시뮬 진입마다 SimApp 상태 초기화

    when (screen) {
        Screen.MENU -> MenuScreen(
            hasResume = WearStore.loadProgress(context) != null,
            onStart = { withResume ->
                resume = if (withResume) WearStore.loadProgress(context) else null
                if (!withResume) WearStore.clearProgress(context)
                simKey++
                screen = Screen.SIM
            },
            onArchive = { screen = Screen.ARCHIVE },
            onSettings = { screen = Screen.SETTINGS },
        )
        Screen.SIM -> key(simKey) {
            SimApp(ble, sender, resume) { screen = Screen.MENU }
        }
        Screen.ARCHIVE -> ArchiveScreen(sender) { screen = Screen.MENU }
        Screen.SETTINGS -> SettingsScreen { screen = Screen.MENU }
    }
}

@Composable
private fun MenuScreen(
    hasResume: Boolean,
    onStart: (Boolean) -> Unit,
    onArchive: () -> Unit,
    onSettings: () -> Unit,
) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text("ROXLOGY", fontSize = 13.sp, color = RaceYellow)
            if (hasResume) {
                ActionChip("이어서 기록", RaceYellow, Color.Black) { onStart(true) }
                ActionChip("새 레이스 시뮬", NeutralChip, Color.White) { onStart(false) }
            } else {
                ActionChip("레이스 시뮬", RaceYellow, Color.Black) { onStart(false) }
            }
            ActionChip("보관함", NeutralChip, Color.White, onArchive)
            ActionChip("설정", NeutralChip, Color.White, onSettings)
        }
    }
}

// ---------------------------------------------------------------- 보관함 (재전송)
@Composable
private fun ArchiveScreen(sender: WearDataSender, onBack: () -> Unit) {
    val context = LocalContext.current
    val items = remember { WearStore.sessions(context).sortedByDescending { it.createdAtMs } }
    var note by remember { mutableStateOf<String?>(null) }
    val dateFmt = remember { SimpleDateFormat("MM/dd HH:mm", Locale.getDefault()) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 30.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text("보관함", fontSize = 13.sp, color = RaceYellow)
        if (items.isEmpty()) Text("저장된 세션 없음", fontSize = 11.sp)
        items.forEach { s ->
            ActionChip(
                "${dateFmt.format(Date(s.createdAtMs))} · ${fmt(s.totalMs)}",
                NeutralChip, Color.White,
            ) {
                sender.sendRaw(s.id, s.payloadJson, s.clientUpdatedAt)
                note = "재전송함 — 폰 연결 시 업로드"
            }
        }
        note?.let { Text(it, fontSize = 10.sp, color = Chalk, textAlign = TextAlign.Center) }
        Text("최근 20세션 · 72시간 보관", fontSize = 9.sp, color = Color(0xFF8A8A8A))
        ActionChip("뒤로", NeutralChip, Color.White, onBack)
    }
}

// ---------------------------------------------------------------- 설정
@Composable
private fun SettingsScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    var haptic by remember { mutableStateOf(WearStore.hapticEnabled(context)) }
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text("설정", fontSize = 13.sp, color = RaceYellow)
            ActionChip(
                if (haptic) "햅틱 켜짐" else "햅틱 꺼짐",
                if (haptic) RaceYellow else NeutralChip,
                if (haptic) Color.Black else Color.White,
            ) {
                haptic = !haptic
                WearStore.setHaptic(context, haptic)
            }
            ActionChip("뒤로", NeutralChip, Color.White, onBack)
        }
    }
}

// ---------------------------------------------------------------- 시뮬 레코더
@Composable
fun SimApp(
    ble: Pm5BleClient,
    sender: WearDataSender,
    resume: SimSnapshot?,
    onExit: () -> Unit,
) {
    var engineKey by remember { mutableStateOf(0) }
    val engine = remember(engineKey) {
        SimEngine().also {
            if (engineKey == 0 && resume != null) it.restore(WearStoreCodec.toRecorded(resume))
        }
    }
    var version by remember { mutableStateOf(0) } // engine 변경 후 recompose 트리거
    var phase by remember {
        mutableStateOf(if (resume != null) AppPhase.RUNNING else AppPhase.IDLE)
    }
    var slotStartMs by remember { mutableStateOf(resume?.slotStartEpochMs ?: 0L) }
    var nowMs by remember { mutableStateOf(System.currentTimeMillis()) }
    var pausedAt by remember { mutableStateOf<Long?>(null) }

    var pm5Connected by remember { mutableStateOf(false) }
    var pm5Latest by remember { mutableStateOf<ErgSample?>(null) }
    var startIso by remember { mutableStateOf(resume?.startIso ?: "") }

    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val tracker = remember { RunDistanceTracker(context) }
    var distNow by remember { mutableStateOf(0.0) }
    var slotStartDist by remember { mutableStateOf(0.0) }
    var goal by remember { mutableStateOf<GoalPlan?>(null) }
    val vibrator = remember { context.getSystemService(Vibrator::class.java) }

    version.let {} // read to subscribe

    fun buzz(ms: Long = 40L) {
        if (!WearStore.hapticEnabled(context)) return
        vibrator?.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE))
    }

    // 진행 스냅샷 영속화 — 크래시/이탈 후 "이어서 기록" 복구용 (erg raw는 미보존)
    fun persist() {
        WearStore.saveProgress(
            context,
            SimSnapshot(startIso, slotStartMs, WearStoreCodec.fromRecorded(engine.recordedSegments())),
        )
    }

    val active = phase == AppPhase.RUNNING && !engine.isDone && pausedAt == null
    LaunchedEffect(active, slotStartMs) {
        while (active) {
            nowMs = System.currentTimeMillis()
            distNow = tracker.distanceMeters
            // 트레드밀 실거리 1km 도달 시 자동 랩 (수동 랩 버튼도 상시)
            if (engine.current?.kind == "run" && tracker.active &&
                (distNow - slotStartDist) >= app.roxlogy.shared.sim.HyroxSim.RUN_METERS
            ) {
                engine.record(System.currentTimeMillis() - slotStartMs)
                version++
                buzz()
                persist()
                if (engine.isDone) {
                    phase = AppPhase.DONE
                    scope.launch { tracker.stop() }
                } else {
                    slotStartMs = System.currentTimeMillis()
                    slotStartDist = tracker.distanceMeters
                }
            }
            delay(250)
        }
    }

    val bleLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { grants ->
        if (grants.values.all { it }) {
            ble.start(object : Pm5BleClient.Listener {
                override fun onConnected() { pm5Connected = true }
                override fun onDisconnected() { pm5Connected = false }
                override fun onSamples(samples: List<ErgSample>) { pm5Latest = samples.lastOrNull() }
            })
        }
    }

    // 러닝 실거리(Health Services)용 ACTIVITY_RECOGNITION — 거부되면 tracker.start()가 false로
    // 떨어져 수동 랩 폴백이 쓰인다.
    val activityLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { _ ->
        scope.launch { tracker.start() }
    }

    fun beginSlotTimer() {
        slotStartMs = System.currentTimeMillis()
        nowMs = slotStartMs
        slotStartDist = tracker.distanceMeters
    }

    fun start() {
        startIso = Instant.now().toString()
        phase = AppPhase.RUNNING
        beginSlotTimer()
        persist()
        activityLauncher.launch(Manifest.permission.ACTIVITY_RECOGNITION)
        scope.launch { goal = WearGoal.load(context) } // 폰이 밀어넣은 목표 로드
    }

    fun recordCurrent() {
        val elapsed = System.currentTimeMillis() - slotStartMs
        val isMachine = SessionAssembler.isMachine(engine.current?.machineType)
        val erg = if (engine.current?.kind == "station" && isMachine) ble.snapshot() else emptyList()
        engine.record(elapsed, erg)
        if (isMachine) ble.resetSamples() // 기록 즉시 비움 — 다음 세그먼트로 새지 않게
        version++
        buzz()
        persist()
        if (engine.isDone) {
            phase = AppPhase.DONE
            buzz(200)
            scope.launch { tracker.stop() }
        } else {
            beginSlotTimer()
            // 머신 스테이션(스키/로잉) 진입: 이전 스테이션 잔여 샘플 제거 + 재스캔.
            // 스키와 로잉은 다른 PM5라 기존 연결을 유지하면 엉뚱한 머신의 샘플이 붙는다.
            // 같은 머신 재사용(훈련)이어도 재스캔은 1~2초면 같은 기기에 다시 붙는다.
            val next = engine.current
            if (next?.kind == "station" && SessionAssembler.isMachine(next.machineType)) {
                ble.resetSamples()
                if (ble.restartIfStarted()) pm5Connected = false // 재연결까지 표시 끔
            }
        }
    }

    // 잘못 누른 랩 되돌리기 — 이전 슬롯으로 돌아가 그 기록 시점부터 타이머가 이어진다
    fun undoLap() {
        val undone = engine.undoLast() ?: return
        version++
        if (phase == AppPhase.DONE) phase = AppPhase.RUNNING
        slotStartMs = System.currentTimeMillis() - undone
        pausedAt = null
        buzz(120)
        persist()
    }

    fun pause() {
        pausedAt = System.currentTimeMillis()
        nowMs = pausedAt!!
        buzz(60)
    }

    fun resumeRun() {
        val p = pausedAt ?: return
        slotStartMs += System.currentTimeMillis() - p // 정지 시간만큼 슬롯 시작을 밀어 경과 보정
        pausedAt = null
        persist()
        buzz(60)
    }

    fun sendSession() {
        val req = SessionAssembler.assemble(
            sessionId = UUID.randomUUID().toString(),
            startedAtIso = startIso.ifEmpty { Instant.now().toString() },
            clientUpdatedAtIso = Instant.now().toString(),
            endedAtIso = Instant.now().toString(),
            segments = engine.recordedSegments(),
        )
        val payload = IngestJson.encode(req)
        sender.sendRaw(req.session.id, payload, req.session.client_updated_at)
        WearStore.addSession(
            context,
            StoredSession(
                id = req.session.id,
                createdAtMs = System.currentTimeMillis(),
                totalMs = engine.elapsedTotalMs(),
                clientUpdatedAt = req.session.client_updated_at,
                payloadJson = payload,
                sent = true,
            ),
        )
        WearStore.clearProgress(context)
        phase = AppPhase.SENT
        buzz(120)
    }

    fun resetAll() {
        ble.stop()
        scope.launch { tracker.stop() }
        WearStore.clearProgress(context)
        pm5Connected = false
        pm5Latest = null
        distNow = 0.0
        slotStartDist = 0.0
        pausedAt = null
        engineKey++
        phase = AppPhase.IDLE
    }

    val elapsed = nowMs - slotStartMs
    val kind = engine.current?.kind
    val round = engine.current?.index ?: 0
    val runDistM = distNow - slotStartDist
    val runProgress =
        if (kind == "run") {
            if (tracker.active) {
                (runDistM / app.roxlogy.shared.sim.HyroxSim.RUN_METERS).coerceIn(0.0, 1.0).toFloat()
            } else {
                (elapsed.toFloat() / NOMINAL_RUN_MS).coerceIn(0f, 1f)
            }
        } else {
            0f
        }
    val diff = engine.checkpointDiffMs(goal)

    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        SimRings(
            stationDone = engine.stationDoneCount(),
            activeStation = engine.activeStationOrdinal(),
            runProgress = runProgress,
            modifier = Modifier.fillMaxSize().padding(4.dp),
        )

        // 단계 인지용 중앙 배경 — 링 안쪽 원을 단계 색으로 칠한다
        val phaseBg = if (phase == AppPhase.RUNNING) {
            when (kind) {
                "run" -> RunBg
                "station" -> StationBg
                else -> RoxzoneBg
            }
        } else Color.Transparent
        Box(Modifier.fillMaxSize(0.70f).clip(CircleShape).background(phaseBg))

        Column(
            modifier = Modifier.fillMaxSize().padding(38.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            when (phase) {
                AppPhase.IDLE -> {
                    Text("하이록스", textAlign = TextAlign.Center)
                    Text("시뮬레이션", textAlign = TextAlign.Center)
                    ActionChip("시작", RaceYellow, Color.Black) { start() }
                    ActionChip("메뉴", NeutralChip, Color.White, onExit)
                }
                AppPhase.RUNNING -> if (pausedAt != null) {
                    Text("일시정지됨", fontSize = 13.sp, color = Chalk)
                    Text(fmt(elapsed), fontSize = 26.sp)
                    ActionChip("재개", RaceYellow, Color.Black) { resumeRun() }
                    ActionChip("메뉴 (기록 유지)", NeutralChip, Color.White, onExit)
                } else {
                    when (kind) {
                        "run" -> {
                            Text("RUN $round", fontSize = 13.sp, color = RunBlue)
                            Text(fmt(elapsed), fontSize = 26.sp)
                            if (tracker.active) {
                                Text("${runDistM.toInt()} m / 1km", fontSize = 11.sp)
                            } else {
                                Text("탭 = 1km 랩", fontSize = 11.sp)
                            }
                            DiffBadge(diff)
                            ActionChip("1km 완료", RunBlue, Color.White) { recordCurrent() }
                        }
                        "roxzone" -> {
                            Text("록스존 · 이동", fontSize = 13.sp, color = Chalk)
                            Text(fmt(elapsed), fontSize = 26.sp)
                            ActionChip("스테이션 시작", Chalk, Color.Black) { recordCurrent() }
                        }
                        "station" -> {
                            Text("STATION $round", fontSize = 12.sp, color = RaceYellow)
                            Text(STATION_LABEL[engine.current?.stationKey] ?: "스테이션", fontSize = 15.sp)
                            Text(fmt(elapsed), fontSize = 24.sp)
                            val machine = SessionAssembler.isMachine(engine.current?.machineType)
                            if (machine) {
                                if (pm5Connected) {
                                    val s = pm5Latest
                                    Text("${s?.watts ?: 0}W · spm ${s?.spm ?: 0}", fontSize = 11.sp)
                                } else {
                                    ActionChip("PM5 연결", NeutralChip, Color.White) {
                                        bleLauncher.launch(blePermissions())
                                    }
                                }
                            }
                            DiffBadge(diff)
                            ActionChip("완료", RaceYellow, Color.Black) { recordCurrent() }
                        }
                        else -> Text("…")
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        ActionChip("⏸", NeutralChip, Color.White) { pause() }
                        if (engine.index > 0) {
                            ActionChip("↩ 랩", NeutralChip, Color.White) { undoLap() }
                        }
                    }
                }
                AppPhase.DONE -> {
                    Text("시뮬 완료 ✓", color = RaceYellow)
                    Text(fmt(engine.elapsedTotalMs()), fontSize = 24.sp)
                    DiffBadge(diff)
                    ActionChip("전송", RaceYellow, Color.Black) { sendSession() }
                    ActionChip("↩ 랩 취소", NeutralChip, Color.White) { undoLap() }
                }
                AppPhase.SENT -> {
                    Text("전송됨 ✓")
                    ActionChip("새 시뮬", NeutralChip, Color.White) { resetAll() }
                    ActionChip("메뉴", NeutralChip, Color.White, onExit)
                }
            }
        }
    }
}
