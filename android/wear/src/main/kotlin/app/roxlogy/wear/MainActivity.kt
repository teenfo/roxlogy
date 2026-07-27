package app.roxlogy.wear

import android.Manifest
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.KeyEvent
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.VerticalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CompactChip
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.dialog.Alert
import androidx.wear.compose.material.dialog.Dialog
import androidx.wear.ambient.AmbientLifecycleObserver
import app.roxlogy.shared.ingest.ErgSample
import app.roxlogy.shared.ingest.IngestJson
import app.roxlogy.shared.record.SessionAssembler
import app.roxlogy.shared.record.SimSnapshot
import app.roxlogy.shared.record.StoredSession
import app.roxlogy.shared.model.Stations
import app.roxlogy.shared.record.WearStoreCodec
import app.roxlogy.shared.sim.GoalPlan
import app.roxlogy.shared.sim.HyroxSim
import app.roxlogy.shared.sim.SimEngine
import app.roxlogy.wear.ble.Pm5BleClient
import app.roxlogy.wear.run.RunDistanceTracker
import app.roxlogy.wear.service.SimSessionService
import app.roxlogy.wear.store.WearStore
import app.roxlogy.wear.sync.WearDataSender
import app.roxlogy.wear.sync.WearGoal
import app.roxlogy.wear.ui.ArchiveScreen
import app.roxlogy.wear.ui.BrandHeader
import app.roxlogy.wear.ui.GoalScreen
import app.roxlogy.wear.ui.MenuScreen
import app.roxlogy.wear.ui.MetricCell
import app.roxlogy.wear.ui.SettingsScreen
import app.roxlogy.wear.ui.SimRings
import app.roxlogy.wear.ui.WodPlayerScreen
import app.roxlogy.wear.ui.theme.Bad
import app.roxlogy.wear.ui.theme.Chalk
import app.roxlogy.wear.ui.theme.Good
import app.roxlogy.wear.ui.theme.MutedText
import app.roxlogy.wear.ui.theme.RaceYellow
import app.roxlogy.wear.ui.theme.RoxWearTheme
import app.roxlogy.wear.ui.theme.RoxzoneBg
import app.roxlogy.wear.ui.theme.RunBg
import app.roxlogy.wear.ui.theme.StationBg
import app.roxlogy.wear.ui.theme.SurfaceHi
import app.roxlogy.wear.ui.theme.TrackBlue
import app.roxlogy.wear.ui.theme.hrZoneColor
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.util.UUID

/**
 * 워치 하이록스 시뮬레이션 레코더 — M10-R 재설계.
 * 메뉴/보관함/목표/설정 = ScalingLazyColumn 표준 Wear 화면, 시뮬 = 두 링(서클) 컨셉 유지.
 * 시뮬: 좌 스와이프 = 컨트롤(일시정지·랩취소·종료), 상하 스와이프 = 데이터 뷰(삼성헬스 패턴),
 * 뒤로가기 = 종료 확인, 퀵버튼(STEM) = 랩. 32슬롯(록스존 IN/OUT), PM5 는 종목명 칩으로 연결.
 */
class MainActivity : ComponentActivity() {
    private lateinit var ble: Pm5BleClient
    private lateinit var sender: WearDataSender

    private val ambientCallback = object : AmbientLifecycleObserver.AmbientLifecycleCallback {
        override fun onEnterAmbient(ambientDetails: AmbientLifecycleObserver.AmbientDetails) {
            if (WearStore.ambientEnabled(this@MainActivity)) AmbientState.ambient = true
        }
        override fun onExitAmbient() { AmbientState.ambient = false }
        override fun onUpdateAmbient() { AmbientState.tick++ }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ble = Pm5BleClient(this)
        sender = WearDataSender(this)
        lifecycle.addObserver(AmbientLifecycleObserver(this, ambientCallback))
        setContent { RoxWearTheme { RootApp(ble, sender) } }
    }

    // 워치 물리 퀵버튼(멀티펑션/STEM) → 시뮬 랩. 홈(전원)·뒤로가기는 시스템 예약.
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_STEM_1 ||
            keyCode == KeyEvent.KEYCODE_STEM_2 ||
            keyCode == KeyEvent.KEYCODE_STEM_PRIMARY
        ) {
            if (QuickButton.press()) return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onDestroy() {
        ble.stop()
        super.onDestroy()
    }
}

/** 물리 퀵버튼 → 현재 시뮬 화면으로 전달하는 버스. */
object QuickButton {
    @Volatile
    var handler: (() -> Boolean)? = null
    fun press(): Boolean = handler?.invoke() ?: false
}

/** 앰비언트(AOD) 상태 — MainActivity 옵저버가 갱신, 시뮬 화면이 구독. */
object AmbientState {
    var ambient by mutableStateOf(false)
    var tick by mutableStateOf(0) // 앰비언트 중 분 단위 갱신 트리거
}

private enum class AppPhase { IDLE, RUNNING, DONE, SENT }
private enum class Screen { MENU, SIM, ARCHIVE, SETTINGS, GOAL, WOD, ERG }

// 1차 러닝 진행 시각 페이서(실거리 미지원 시). 5:00/km.
private const val NOMINAL_RUN_MS = 300_000L

private val STATION_LABEL = mapOf(
    "ski" to "SkiErg", "sledpush" to "Sled Push", "sledpull" to "Sled Pull",
    "burpee" to "Burpee BJ", "row" to "Rowing", "farmers" to "Farmers",
    "lunges" to "Lunges", "wallballs" to "Wall Balls",
)

private fun fmt(ms: Long): String {
    val t = (ms / 1000).coerceAtLeast(0)
    val h = t / 3600
    return if (h > 0) "%d:%02d:%02d".format(h, (t % 3600) / 60, t % 60)
    else "%d:%02d".format(t / 60, t % 60)
}

private fun fmtDiff(ms: Long): String {
    val a = Math.abs(ms) / 1000
    return (if (ms <= 0) "-" else "+") + "%d:%02d".format(a / 60, a % 60)
}

@Composable
private fun DiffBadge(diffMs: Long?, fontSize: Int = 11) {
    if (diffMs == null) return
    Text(
        "목표 " + fmtDiff(diffMs),
        fontSize = fontSize.sp,
        color = if (diffMs <= 0) Good else Bad,
    )
}

/** 주 액션 버튼 — 전폭·15sp Bold (전 화면 공통 규격). */
@Composable
private fun ActionChip(text: String, bg: Color, fg: Color, onClick: () -> Unit) {
    Chip(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(0.9f).height(40.dp),
        colors = ChipDefaults.chipColors(backgroundColor = bg, contentColor = fg),
        label = {
            Text(
                text, fontSize = 15.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center,
            )
        },
    )
}

/** 보조 액션 버튼 — 주 액션과 시각 위계 분리. */
@Composable
private fun SubActionChip(text: String, onClick: () -> Unit) {
    CompactChip(
        onClick = onClick,
        colors = ChipDefaults.chipColors(backgroundColor = SurfaceHi, contentColor = Color.White),
        label = { Text(text, fontSize = 12.sp) },
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
    var simKey by remember { mutableStateOf(0) }
    var goal by remember { mutableStateOf<GoalPlan?>(null) }
    var hasWod by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    // BLE 권한 보장 헬퍼 — 승인되면 대기 중인 동작 실행 (에르그/WOD/설정 테스트 공용)
    var pendingBleGrant by remember { mutableStateOf<(() -> Unit)?>(null) }
    val bleGrantLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { grants ->
        if (grants.values.all { it }) pendingBleGrant?.invoke()
        pendingBleGrant = null
    }
    val ensureBle: ((() -> Unit) -> Unit) = { onGranted ->
        pendingBleGrant = onGranted
        bleGrantLauncher.launch(blePermissions())
    }

    LaunchedEffect(screen) {
        if (screen == Screen.MENU) {
            hasWod = app.roxlogy.wear.sync.WearWod.load(context)?.items?.isNotEmpty() == true
        }
    }

    // 메뉴 외 화면에서 뒤로가기 → 메뉴 (시뮬은 SimApp 내부 BackHandler 가 우선)
    BackHandler(enabled = screen != Screen.MENU && screen != Screen.SIM) { screen = Screen.MENU }

    when (screen) {
        Screen.MENU -> MenuScreen(
            hasResume = WearStore.loadProgress(context) != null,
            hasWod = hasWod,
            onStart = { withResume ->
                resume = if (withResume) WearStore.loadProgress(context) else null
                if (!withResume) WearStore.clearProgress(context)
                simKey++
                screen = Screen.SIM
            },
            onWod = { screen = Screen.WOD },
            onErg = { screen = Screen.ERG },
            onGoal = {
                scope.launch { goal = WearGoal.load(context) }
                screen = Screen.GOAL
            },
            onArchive = { screen = Screen.ARCHIVE },
            onSettings = { screen = Screen.SETTINGS },
        )
        Screen.SIM -> key(simKey) {
            SimApp(ble, sender, resume) { screen = Screen.MENU }
        }
        Screen.ARCHIVE -> ArchiveScreen(sender)
        Screen.SETTINGS -> SettingsScreen(ble, ensureBle)
        Screen.GOAL -> GoalScreen(goal, STATION_LABEL)
        Screen.WOD -> WodPlayerScreen(sender, ble, ensureBle)
        Screen.ERG -> app.roxlogy.wear.ui.ErgScreen(ble, sender, ensureBle)
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
    var version by remember { mutableStateOf(0) }
    var phase by remember {
        mutableStateOf(if (resume != null) AppPhase.RUNNING else AppPhase.IDLE)
    }
    var slotStartMs by remember { mutableStateOf(resume?.slotStartEpochMs ?: 0L) }
    var nowMs by remember { mutableStateOf(System.currentTimeMillis()) }
    var pausedAt by remember { mutableStateOf<Long?>(null) }
    var showExit by remember { mutableStateOf(false) }

    var pm5Connected by remember { mutableStateOf(false) }
    var pm5Scanning by remember { mutableStateOf(false) }
    var pm5Latest by remember { mutableStateOf<ErgSample?>(null) }
    var startIso by remember { mutableStateOf(resume?.startIso ?: "") }

    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val tracker = remember { RunDistanceTracker(context) }
    var distNow by remember { mutableStateOf(0.0) }
    var slotStartDist by remember { mutableStateOf(0.0) }
    var goal by remember { mutableStateOf<GoalPlan?>(null) }
    val vibrator = remember { context.getSystemService(Vibrator::class.java) }

    // 슬롯별 심박 집계
    var hrSum by remember { mutableStateOf(0.0) }
    var hrN by remember { mutableStateOf(0) }
    var hrMax by remember { mutableStateOf(0.0) }
    var hrNow by remember { mutableStateOf(0.0) }
    fun slotAvgHr(): Int? = if (hrN > 0) (hrSum / hrN).toInt() else null
    fun slotMaxHr(): Int? = if (hrN > 0) hrMax.toInt() else null
    fun resetSlotHr() { hrSum = 0.0; hrN = 0; hrMax = 0.0 }

    version.let {}

    // 설정: 화면 항상 켜기 (시뮬 화면에 있는 동안)
    val activity = context as? ComponentActivity
    DisposableEffect(Unit) {
        if (WearStore.screenOnEnabled(context)) {
            activity?.window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
        onDispose {
            activity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    fun buzz(ms: Long = 40L) {
        if (!WearStore.hapticEnabled(context)) return
        vibrator?.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE))
    }

    fun persist() {
        WearStore.saveProgress(
            context,
            SimSnapshot(startIso, slotStartMs, WearStoreCodec.fromRecorded(engine.recordedSegments())),
        )
    }

    // 이어서 기록으로 재진입한 경우에도 진행 서비스 유지
    LaunchedEffect(phase) {
        if (phase == AppPhase.RUNNING) SimSessionService.start(context)
        if (phase == AppPhase.SENT || phase == AppPhase.IDLE) SimSessionService.stop(context)
    }

    val active = phase == AppPhase.RUNNING && !engine.isDone && pausedAt == null
    LaunchedEffect(active, slotStartMs) {
        while (active) {
            nowMs = System.currentTimeMillis()
            distNow = tracker.distanceMeters
            hrNow = tracker.heartRateBpm
            if (hrNow > 30.0) { hrSum += hrNow; hrN++; if (hrNow > hrMax) hrMax = hrNow }
            if (engine.current?.kind == "run" && tracker.active &&
                (distNow - slotStartDist) >= HyroxSim.RUN_METERS
            ) {
                engine.record(
                    System.currentTimeMillis() - slotStartMs,
                    avgHr = slotAvgHr(), maxHr = slotMaxHr(),
                )
                version++
                buzz()
                persist()
                if (engine.isDone) {
                    phase = AppPhase.DONE
                    scope.launch { tracker.stop() }
                } else {
                    slotStartMs = System.currentTimeMillis()
                    slotStartDist = tracker.distanceMeters
                    resetSlotHr()
                }
            }
            delay(250)
        }
    }

    val bleLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { grants ->
        if (grants.values.all { it }) {
            pm5Scanning = true
            ble.start(object : Pm5BleClient.Listener {
                override fun onConnected() { pm5Connected = true; pm5Scanning = false }
                override fun onDisconnected() { pm5Connected = false }
                override fun onSamples(samples: List<ErgSample>) { pm5Latest = samples.lastOrNull() }
            })
        }
    }

    val activityLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { _ ->
        scope.launch { tracker.start() }
    }

    fun beginSlotTimer() {
        slotStartMs = System.currentTimeMillis()
        nowMs = slotStartMs
        slotStartDist = tracker.distanceMeters
        resetSlotHr()
    }

    fun start() {
        startIso = Instant.now().toString()
        phase = AppPhase.RUNNING
        beginSlotTimer()
        persist()
        SimSessionService.start(context) // 화면 꺼짐에도 세션 유지 + 워치페이스 복귀 아이콘
        val perms = mutableListOf(
            Manifest.permission.ACTIVITY_RECOGNITION, Manifest.permission.BODY_SENSORS,
        )
        if (Build.VERSION.SDK_INT >= 33) perms.add(Manifest.permission.POST_NOTIFICATIONS)
        activityLauncher.launch(perms.toTypedArray())
        scope.launch { goal = WearGoal.load(context) }
    }

    fun recordCurrent() {
        val elapsed = System.currentTimeMillis() - slotStartMs
        val isMachine = SessionAssembler.isMachine(engine.current?.machineType)
        val erg = if (engine.current?.kind == "station" && isMachine) ble.snapshot() else emptyList()
        engine.record(elapsed, erg, slotAvgHr(), slotMaxHr())
        if (isMachine) ble.resetSamples()
        version++
        buzz()
        persist()
        if (engine.isDone) {
            phase = AppPhase.DONE
            buzz(200)
            scope.launch { tracker.stop() }
        } else {
            beginSlotTimer()
            val next = engine.current
            if (next?.kind == "station" && SessionAssembler.isMachine(next.machineType)) {
                ble.resetSamples()
                if (ble.restartIfStarted()) pm5Connected = false
            }
        }
    }

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
        slotStartMs += System.currentTimeMillis() - p
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

    // 뒤로가기: 진행 중이면 종료 확인, 아니면 즉시 메뉴
    BackHandler {
        if (phase == AppPhase.RUNNING) showExit = true else onExit()
    }

    // 물리 퀵버튼 = 현재 단계 완료 (진행 중에만)
    DisposableEffect(Unit) {
        QuickButton.handler = handler@{
            if (phase != AppPhase.RUNNING || pausedAt != null || engine.isDone) return@handler false
            recordCurrent()
            true
        }
        onDispose { QuickButton.handler = null }
    }

    // 앰비언트(AOD): 진행 중이면 저전력 간소 화면 (검정 배경·타이머·종목만)
    if (AmbientState.ambient && phase == AppPhase.RUNNING) {
        AmbientState.tick.let {} // 분 단위 갱신 구독
        val ambElapsed = if (pausedAt != null) pausedAt!! - slotStartMs
        else System.currentTimeMillis() - slotStartMs
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    when (engine.current?.kind) {
                        "run" -> "RUN ${engine.current?.index ?: 0}"
                        "station" -> STATION_LABEL[engine.current?.stationKey] ?: "STATION"
                        else -> "록스존"
                    },
                    fontSize = 13.sp, color = MutedText,
                )
                Text(fmt(ambElapsed), fontSize = 32.sp, fontWeight = FontWeight.Bold, color = Chalk)
                if (pausedAt != null) Text("일시정지됨", fontSize = 11.sp, color = MutedText)
            }
        }
        return
    }

    val elapsed = nowMs - slotStartMs
    val kind = engine.current?.kind
    val round = engine.current?.index ?: 0
    val runDistM = distNow - slotStartDist
    val runProgress =
        if (kind == "run") {
            if (tracker.active) {
                (runDistM / HyroxSim.RUN_METERS).coerceIn(0.0, 1.0).toFloat()
            } else {
                (elapsed.toFloat() / NOMINAL_RUN_MS).coerceIn(0f, 1f)
            }
        } else 0f
    val diff = engine.checkpointDiffMs(goal)
    val slots = engine.slots
    val nextSlot = slots.getOrNull(engine.index + 1)
    val slotTarget = HyroxSim.slotTargetMs(engine.index, goal, slots)

    // 좌 스와이프 컨트롤 페이지 (진행 중에만 2페이지)
    val hasControls = phase == AppPhase.RUNNING
    val hPager = rememberPagerState { if (hasControls) 2 else 1 }

    HorizontalPager(state = hPager, modifier = Modifier.fillMaxSize()) { page ->
        if (page == 0) {
            SimMainPage(
                engine = engine, phase = phase, kind = kind, round = round,
                elapsed = elapsed, runDistM = runDistM, runProgress = runProgress,
                trackerActive = tracker.active, diff = diff, hrNow = hrNow,
                pm5Connected = pm5Connected, pm5Scanning = pm5Scanning, pm5Latest = pm5Latest,
                slotTarget = slotTarget, nextKind = nextSlot?.kind,
                nextLabel = nextSlot?.let { s ->
                    when (s.kind) {
                        "run" -> "RUN ${s.index}"
                        "station" -> STATION_LABEL[s.stationKey] ?: "스테이션"
                        else -> "록스존"
                    }
                },
                paused = pausedAt != null,
                onStart = { start() },
                onRecord = { recordCurrent() },
                onResume = { resumeRun() },
                onConnectPm5 = { bleLauncher.launch(blePermissions()) },
                onSend = { sendSession() },
                onUndo = { undoLap() },
                onReset = {
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
                },
                onExit = onExit,
            )
        } else {
            // 컨트롤 페이지 — 일시정지/재개 · 랩 취소 · 종료 (삼성헬스 패턴)
            Column(
                modifier = Modifier.fillMaxSize().padding(horizontal = 30.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Chip(
                    onClick = {
                        if (pausedAt == null) pause() else resumeRun()
                        scope.launch { hPager.animateScrollToPage(0) }
                    },
                    colors = ChipDefaults.primaryChipColors(),
                    label = { Text(if (pausedAt == null) "⏸ 일시정지" else "▶ 재개", fontSize = 14.sp) },
                )
                Chip(
                    onClick = {
                        undoLap()
                        scope.launch { hPager.animateScrollToPage(0) }
                    },
                    enabled = engine.index > 0,
                    colors = ChipDefaults.secondaryChipColors(backgroundColor = SurfaceHi),
                    label = { Text("↩ 랩 되돌리기", fontSize = 14.sp) },
                )
                Chip(
                    onClick = { showExit = true },
                    colors = ChipDefaults.secondaryChipColors(backgroundColor = SurfaceHi),
                    label = { Text("✕ 시뮬 종료", fontSize = 14.sp, color = Bad) },
                )
                Text("● ○", fontSize = 9.sp, color = MutedText)
            }
        }
    }

    // 종료 확인 다이얼로그
    Dialog(showDialog = showExit, onDismissRequest = { showExit = false }) {
        Alert(
            title = { Text("시뮬을 종료할까요?", fontSize = 14.sp, textAlign = TextAlign.Center) },
            content = {
                Text(
                    "진행 기록은 저장되어\n'이어서 기록'으로 복귀할 수 있습니다",
                    fontSize = 11.sp, color = MutedText, textAlign = TextAlign.Center,
                )
            },
            negativeButton = {
                Chip(
                    onClick = { showExit = false },
                    colors = ChipDefaults.secondaryChipColors(backgroundColor = SurfaceHi),
                    label = { Text("계속", fontSize = 12.sp) },
                )
            },
            positiveButton = {
                Chip(
                    onClick = {
                        showExit = false
                        persist()
                        SimSessionService.stop(context)
                        onExit()
                    },
                    colors = ChipDefaults.primaryChipColors(),
                    label = { Text("종료", fontSize = 12.sp) },
                )
            },
        )
    }
}

// ---------------------------------------------------------------- 시뮬 메인 페이지 (상하 뷰)
@Composable
private fun SimMainPage(
    engine: SimEngine,
    phase: AppPhase,
    kind: String?,
    round: Int,
    elapsed: Long,
    runDistM: Double,
    runProgress: Float,
    trackerActive: Boolean,
    diff: Long?,
    hrNow: Double,
    pm5Connected: Boolean,
    pm5Scanning: Boolean,
    pm5Latest: ErgSample?,
    slotTarget: Long?,
    nextKind: String?,
    nextLabel: String?,
    paused: Boolean,
    onStart: () -> Unit,
    onRecord: () -> Unit,
    onResume: () -> Unit,
    onConnectPm5: () -> Unit,
    onSend: () -> Unit,
    onUndo: () -> Unit,
    onReset: () -> Unit,
    onExit: () -> Unit,
) {
    // 상하 스와이프 데이터 뷰: 진행 중에만 3뷰(기본/상세/스플릿)
    val views = if (phase == AppPhase.RUNNING && !paused) 3 else 1
    val vPager = rememberPagerState { views }

    VerticalPager(state = vPager, modifier = Modifier.fillMaxSize()) { v ->
        when (v) {
            0 -> RingView(
                engine, phase, kind, round, elapsed, runDistM, runProgress, trackerActive,
                diff, hrNow, pm5Connected, pm5Scanning, pm5Latest, slotTarget, nextKind, nextLabel,
                paused, onStart, onRecord, onResume, onConnectPm5, onSend, onUndo, onReset, onExit,
            )
            1 -> DetailView(elapsed, hrNow, pm5Connected, pm5Latest, slotTarget, nextLabel, diff)
            else -> SplitsView(engine)
        }
    }
}

/** 뷰1 — 두 링 + 타이머 + 고정 위치 액션 (메인 컨셉 유지). */
@Composable
private fun RingView(
    engine: SimEngine,
    phase: AppPhase,
    kind: String?,
    round: Int,
    elapsed: Long,
    runDistM: Double,
    runProgress: Float,
    trackerActive: Boolean,
    diff: Long?,
    hrNow: Double,
    pm5Connected: Boolean,
    pm5Scanning: Boolean,
    pm5Latest: ErgSample?,
    slotTarget: Long?,
    nextKind: String?,
    nextLabel: String?,
    paused: Boolean,
    onStart: () -> Unit,
    onRecord: () -> Unit,
    onResume: () -> Unit,
    onConnectPm5: () -> Unit,
    onSend: () -> Unit,
    onUndo: () -> Unit,
    onReset: () -> Unit,
    onExit: () -> Unit,
) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        SimRings(
            stationDone = engine.stationDoneCount(),
            activeStation = engine.activeStationOrdinal(),
            runProgress = runProgress,
            modifier = Modifier.fillMaxSize().padding(4.dp),
        )

        val phaseBg = if (phase == AppPhase.RUNNING && !paused) {
            when (kind) {
                "run" -> RunBg
                "station" -> StationBg
                else -> RoxzoneBg
            }
        } else Color.Transparent
        Box(Modifier.fillMaxSize(0.70f).clip(CircleShape).background(phaseBg))

        // 고정 3영역: 헤더(상) / 타이머·정보(중) / 액션(하) — 버튼 위치 항상 동일
        Column(
            modifier = Modifier.fillMaxSize().padding(horizontal = 40.dp, vertical = 34.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // ── 헤더 영역 (고정 높이)
            Column(
                modifier = Modifier.weight(1.1f),
                verticalArrangement = Arrangement.Bottom,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                when {
                    phase == AppPhase.IDLE -> BrandHeader(sub = "레이스 시뮬")
                    phase == AppPhase.DONE || phase == AppPhase.SENT ->
                        Text(
                            if (phase == AppPhase.DONE) "시뮬 완료 ✓" else "전송됨 ✓",
                            fontSize = 14.sp, color = RaceYellow, fontWeight = FontWeight.Bold,
                        )
                    paused -> Text("일시정지됨", fontSize = 14.sp, color = Chalk, fontWeight = FontWeight.Bold)
                    kind == "run" -> Text("RUN $round", fontSize = 14.sp, color = TrackBlue, fontWeight = FontWeight.Bold)
                    kind == "station" -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("STATION $round", fontSize = 11.sp, color = RaceYellow)
                        val label = STATION_LABEL[engine.current?.stationKey] ?: "스테이션"
                        if (SessionAssembler.isMachine(engine.current?.machineType)) {
                            // 종목명 자체가 PM5 연결 버튼 — 탭 = 연결, 연결되면 ✓
                            CompactChip(
                                onClick = { if (!pm5Connected && !pm5Scanning) onConnectPm5() },
                                modifier = Modifier.height(30.dp),
                                colors = ChipDefaults.chipColors(
                                    backgroundColor = if (pm5Connected) StationBg else SurfaceHi,
                                    contentColor = if (pm5Connected) RaceYellow else Color.White,
                                ),
                                label = {
                                    Text(
                                        when {
                                            pm5Connected -> "$label ✓"
                                            pm5Scanning -> "연결 중…"
                                            else -> label
                                        },
                                        fontSize = 13.sp, fontWeight = FontWeight.Bold,
                                    )
                                },
                            )
                        } else {
                            Text(label, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                    else -> Text("록스존 · 이동", fontSize = 14.sp, color = Chalk, fontWeight = FontWeight.Bold)
                }
            }

            // ── 타이머·정보 영역
            Column(
                modifier = Modifier.weight(1.6f),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                when (phase) {
                    AppPhase.IDLE -> Text("8×1km + 8 스테이션\n32구간 기록", fontSize = 11.sp, color = MutedText, textAlign = TextAlign.Center)
                    AppPhase.DONE, AppPhase.SENT -> {
                        Text(fmt(engine.elapsedTotalMs()), fontSize = 26.sp, fontWeight = FontWeight.Bold)
                        DiffBadge(diff)
                        SummaryLine(engine)
                    }
                    AppPhase.RUNNING -> {
                        // T자 3분할: 타이머(상단 전폭) + 좌 심박 / 우 상황별 지표
                        Text(fmt(elapsed), fontSize = 30.sp, fontWeight = FontWeight.Bold)
                        if (!paused) {
                            Spacer(Modifier.height(2.dp))
                            Row(
                                modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Min),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                // 좌 칸 — 심박 (자리 고정, 항상 표시)
                                MetricCell(
                                    value = if (hrNow > 30) "${hrNow.toInt()}" else "--",
                                    valueColor = if (hrNow > 30) hrZoneColor(hrNow.toInt()) else MutedText,
                                    sub = "♥ 심박",
                                    modifier = Modifier.weight(1f),
                                )
                                Box(Modifier.width(1.dp).fillMaxHeight().background(SurfaceHi))
                                // 우 칸 — 상황별 핵심 지표 1개
                                when {
                                    kind == "run" -> MetricCell(
                                        value = if (trackerActive) "${runDistM.toInt()}m" else "탭=랩",
                                        valueColor = Chalk,
                                        sub = if (trackerActive) "/ 1km" else "수동 랩",
                                        modifier = Modifier.weight(1f),
                                    )
                                    kind == "station" && pm5Connected -> MetricCell(
                                        value = "${pm5Latest?.watts ?: 0}W",
                                        valueColor = RaceYellow,
                                        sub = "${pm5Latest?.spm ?: 0}spm",
                                        modifier = Modifier.weight(1f),
                                    )
                                    else -> MetricCell(
                                        value = diff?.let { fmtDiff(it) } ?: "--",
                                        valueColor = when {
                                            diff == null -> MutedText
                                            diff <= 0 -> Good
                                            else -> Bad
                                        },
                                        sub = slotTarget?.let { "목표 ${fmt(it)}" } ?: "목표 대비",
                                        modifier = Modifier.weight(1f),
                                    )
                                }
                            }
                        }
                    }
                }
            }

            // ── 액션 영역 (고정 위치)
            Column(
                modifier = Modifier.weight(1.2f),
                verticalArrangement = Arrangement.Top,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                when {
                    phase == AppPhase.IDLE -> {
                        ActionChip("시작", RaceYellow, Color.Black, onStart)
                        Spacer(Modifier.height(2.dp))
                        SubActionChip("메뉴", onExit)
                    }
                    phase == AppPhase.DONE -> {
                        ActionChip("전송", RaceYellow, Color.Black, onSend)
                        Spacer(Modifier.height(2.dp))
                        SubActionChip("↩ 랩 취소", onUndo)
                    }
                    phase == AppPhase.SENT -> {
                        ActionChip("새 시뮬", RaceYellow, Color.Black, onReset)
                        Spacer(Modifier.height(2.dp))
                        SubActionChip("메뉴", onExit)
                    }
                    paused -> ActionChip("▶ 재개", RaceYellow, Color.Black, onResume)
                    kind == "run" -> ActionChip("1km 완료", TrackBlue, Color.White, onRecord)
                    kind == "roxzone" -> ActionChip(
                        when (nextKind) {
                            "station" -> "스테이션 시작"
                            "run" -> "런 시작"
                            else -> "피니시"
                        },
                        Chalk, Color.Black, onRecord,
                    )
                    // PM5 연결은 헤더 종목명 칩으로 이동 — 완료 버튼 위치 항상 고정
                    kind == "station" -> ActionChip("완료", RaceYellow, Color.Black, onRecord)
                }
            }
        }
    }
}

/** DONE/SENT 요약 한 줄 — 합계·평균/최대 심박 (Roxfit 요약 스타일 축약). */
@Composable
private fun SummaryLine(engine: SimEngine) {
    val segs = engine.recordedSegments()
    val runSum = segs.filter { it.kind == "run" }.sumOf { it.splitTimeMs }
    val stSum = segs.filter { it.kind == "station" }.sumOf { it.splitTimeMs }
    val roxSum = segs.filter { it.kind == "roxzone" }.sumOf { it.splitTimeMs }
    val hrSegs = segs.mapNotNull { s -> s.avgHr?.let { it.toLong() * s.splitTimeMs } }
    val hrDur = segs.filter { it.avgHr != null }.sumOf { it.splitTimeMs }
    val avgHr = if (hrDur > 0) (hrSegs.sum() / hrDur).toInt() else null
    val maxHr = segs.mapNotNull { it.maxHr }.maxOrNull()
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            "런 ${fmt(runSum)} · 스테이션 ${fmt(stSum)}",
            fontSize = 9.sp, color = MutedText,
        )
        Text(
            "록스존 ${fmt(roxSum)}" +
                (avgHr?.let { " · ♥$it" + (maxHr?.let { m -> "/$m" } ?: "") } ?: ""),
            fontSize = 9.sp, color = MutedText,
        )
    }
}

/** 뷰2 — 상세 데이터 (심박 존·PM5 라이브·구간 목표·다음 종목). */
@Composable
private fun DetailView(
    elapsed: Long,
    hrNow: Double,
    pm5Connected: Boolean,
    pm5Latest: ErgSample?,
    slotTarget: Long?,
    nextLabel: String?,
    diff: Long?,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 34.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("상세", fontSize = 10.sp, color = MutedText)
        Text(fmt(elapsed), fontSize = 22.sp, fontWeight = FontWeight.Bold)
        if (hrNow > 30) {
            Text("♥ ${hrNow.toInt()} bpm", fontSize = 16.sp, color = hrZoneColor(hrNow.toInt()), fontWeight = FontWeight.Bold)
        } else {
            Text("♥ --", fontSize = 14.sp, color = MutedText)
        }
        if (pm5Connected && pm5Latest != null) {
            Text(
                "${pm5Latest.watts ?: 0}W · ${pm5Latest.spm ?: 0}spm" +
                    (pm5Latest.pace?.let { " · ${fmt((it * 1000).toLong())}/500m" } ?: ""),
                fontSize = 12.sp, color = RaceYellow,
            )
        }
        if (slotTarget != null) Text("구간 목표 ${fmt(slotTarget)}", fontSize = 11.sp, color = MutedText)
        DiffBadge(diff)
        if (nextLabel != null) Text("다음: $nextLabel", fontSize = 11.sp, color = Chalk)
    }
}

/** 뷰3 — 완료 구간 스플릿 리스트. */
@Composable
private fun SplitsView(engine: SimEngine) {
    val segs = engine.recordedSegments()
    val exLabel = remember {
        Stations.ALL.associate { it.exerciseId to (STATION_LABEL[it.key] ?: it.key) }
    }
    var runN = 0
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 40.dp, vertical = 28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text("스플릿", fontSize = 10.sp, color = MutedText)
        if (segs.isEmpty()) Text("완료 구간 없음", fontSize = 11.sp, color = MutedText)
        segs.forEach { s ->
            val label = when (s.kind) {
                "run" -> { runN++; "런$runN" }
                "station" -> exLabel[s.exerciseId] ?: "스테이션"
                else -> "록스존"
            }
            androidx.compose.foundation.layout.Row {
                Text(label, fontSize = 11.sp, color = MutedText, modifier = Modifier.weight(1f))
                Text(fmt(s.splitTimeMs), fontSize = 11.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}
