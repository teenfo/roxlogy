package app.roxlogy.wear

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import app.roxlogy.shared.ingest.ErgSample
import app.roxlogy.shared.record.SessionAssembler
import app.roxlogy.shared.sim.SimEngine
import app.roxlogy.wear.ble.Pm5BleClient
import app.roxlogy.wear.run.RunDistanceTracker
import app.roxlogy.wear.sync.WearDataSender
import app.roxlogy.wear.ui.SimRings
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.util.UUID

/**
 * 워치 하이록스 시뮬레이션 레코더 (재정의된 메인 기능).
 * 러닝 8×1km + 스테이션 8 + 록스존을 24슬롯으로 기록 → 세션 조립 → Data Layer로 폰 전송.
 * 배경 = 로고 두 링(바깥 8세그먼트=스테이션 완료, 안쪽 트랙=1km 러닝 진행).
 * PM5(에르그)는 스키/로잉 스테이션에서 raw 보강(선택). BLE·트레드밀 거리는 실기 검증.
 */
class MainActivity : ComponentActivity() {
    private lateinit var ble: Pm5BleClient
    private lateinit var sender: WearDataSender

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ble = Pm5BleClient(this)
        sender = WearDataSender(this)
        setContent { MaterialTheme { SimApp(ble, sender) } }
    }

    override fun onDestroy() {
        ble.stop()
        super.onDestroy()
    }
}

private enum class AppPhase { IDLE, RUNNING, DONE, SENT }

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

private fun blePermissions(): Array<String> =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
    } else {
        arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
    }

@Composable
fun SimApp(ble: Pm5BleClient, sender: WearDataSender) {
    var engineKey by remember { mutableStateOf(0) }
    val engine = remember(engineKey) { SimEngine() }
    var version by remember { mutableStateOf(0) } // engine 변경 후 recompose 트리거
    var phase by remember { mutableStateOf(AppPhase.IDLE) }
    var slotStartMs by remember { mutableStateOf(0L) }
    var nowMs by remember { mutableStateOf(0L) }

    var pm5Connected by remember { mutableStateOf(false) }
    var pm5Latest by remember { mutableStateOf<ErgSample?>(null) }
    var startIso by remember { mutableStateOf("") }

    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val tracker = remember { RunDistanceTracker(context) }
    var distNow by remember { mutableStateOf(0.0) }
    var slotStartDist by remember { mutableStateOf(0.0) }

    version.let {} // read to subscribe

    val active = phase == AppPhase.RUNNING && !engine.isDone
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
        activityLauncher.launch(Manifest.permission.ACTIVITY_RECOGNITION)
    }

    fun recordCurrent() {
        val elapsed = System.currentTimeMillis() - slotStartMs
        val isMachine = SessionAssembler.isMachine(engine.current?.machineType)
        val erg = if (engine.current?.kind == "station" && isMachine) ble.snapshot() else emptyList()
        engine.record(elapsed, erg)
        version++
        if (engine.isDone) {
            phase = AppPhase.DONE
            scope.launch { tracker.stop() }
        } else {
            beginSlotTimer()
        }
    }

    fun sendSession() {
        val session = SessionAssembler.assemble(
            sessionId = UUID.randomUUID().toString(),
            startedAtIso = startIso.ifEmpty { Instant.now().toString() },
            clientUpdatedAtIso = Instant.now().toString(),
            endedAtIso = Instant.now().toString(),
            segments = engine.recordedSegments(),
        )
        sender.sendSession(session)
        phase = AppPhase.SENT
    }

    fun resetAll() {
        ble.stop()
        scope.launch { tracker.stop() }
        pm5Connected = false
        pm5Latest = null
        distNow = 0.0
        slotStartDist = 0.0
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

    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        SimRings(
            stationDone = engine.stationDoneCount(),
            activeStation = engine.activeStationOrdinal(),
            runProgress = runProgress,
            modifier = Modifier.fillMaxSize().padding(4.dp),
        )

        Column(
            modifier = Modifier.fillMaxSize().padding(38.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            when (phase) {
                AppPhase.IDLE -> {
                    Text("하이록스", textAlign = TextAlign.Center)
                    Text("시뮬레이션", textAlign = TextAlign.Center)
                    Button(onClick = { start() }, colors = ButtonDefaults.primaryButtonColors()) {
                        Text("시작")
                    }
                }
                AppPhase.RUNNING -> when (kind) {
                    "run" -> {
                        Text("RUN $round", fontSize = 13.sp, color = MaterialTheme.colors.primary)
                        Text(fmt(elapsed), fontSize = 26.sp)
                        if (tracker.active) {
                            Text("${runDistM.toInt()} m / 1km", fontSize = 11.sp)
                        } else {
                            Text("탭 = 1km 랩", fontSize = 11.sp)
                        }
                        Button(onClick = { recordCurrent() }, colors = ButtonDefaults.primaryButtonColors()) {
                            Text("1km 완료")
                        }
                    }
                    "roxzone" -> {
                        Text("록스존 · 이동", fontSize = 13.sp)
                        Text(fmt(elapsed), fontSize = 26.sp)
                        Button(onClick = { recordCurrent() }, colors = ButtonDefaults.primaryButtonColors()) {
                            Text("스테이션 시작")
                        }
                    }
                    "station" -> {
                        Text("STATION $round", fontSize = 12.sp, color = MaterialTheme.colors.primary)
                        Text(STATION_LABEL[engine.current?.stationKey] ?: "스테이션", fontSize = 15.sp)
                        Text(fmt(elapsed), fontSize = 24.sp)
                        val machine = SessionAssembler.isMachine(engine.current?.machineType)
                        if (machine) {
                            if (pm5Connected) {
                                val s = pm5Latest
                                Text("${s?.watts ?: 0}W · spm ${s?.spm ?: 0}", fontSize = 11.sp)
                            } else {
                                Button(
                                    onClick = { bleLauncher.launch(blePermissions()) },
                                    colors = ButtonDefaults.secondaryButtonColors(),
                                ) { Text("PM5", fontSize = 12.sp) }
                            }
                        }
                        Button(onClick = { recordCurrent() }, colors = ButtonDefaults.primaryButtonColors()) {
                            Text("완료")
                        }
                    }
                    else -> Text("…")
                }
                AppPhase.DONE -> {
                    Text("시뮬 완료 ✓", color = MaterialTheme.colors.primary)
                    Text(fmt(engine.elapsedTotalMs()), fontSize = 24.sp)
                    Button(onClick = { sendSession() }, colors = ButtonDefaults.primaryButtonColors()) {
                        Text("전송")
                    }
                }
                AppPhase.SENT -> {
                    Text("전송됨 ✓")
                    Button(onClick = { resetAll() }, colors = ButtonDefaults.secondaryButtonColors()) {
                        Text("새 시뮬")
                    }
                }
            }
        }
    }
}
