package app.roxlogy.wear

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import app.roxlogy.shared.ingest.ErgSample
import app.roxlogy.shared.model.MachineType
import app.roxlogy.shared.model.Stations
import app.roxlogy.shared.record.RecordedSegment
import app.roxlogy.shared.record.SessionAssembler
import app.roxlogy.wear.ble.Pm5BleClient
import app.roxlogy.wear.sync.WearDataSender
import java.time.Instant
import java.util.UUID

/**
 * N2/N3 워치 레코더 — PM5 연결 후 에르그 1구간을 기록해 세션으로 조립,
 * Data Layer로 폰에 전송한다. BLE 런타임은 실기(워치+PM5)로 검증.
 */
class MainActivity : ComponentActivity() {

    private lateinit var ble: Pm5BleClient
    private lateinit var sender: WearDataSender

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ble = Pm5BleClient(this)
        sender = WearDataSender(this)
        setContent { RecorderApp(ble, sender) }
    }

    override fun onDestroy() {
        ble.stop()
        super.onDestroy()
    }
}

private enum class Phase { IDLE, RECORDING, SENT }

private fun blePermissions(): Array<String> =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
    } else {
        arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
    }

@Composable
fun RecorderApp(ble: Pm5BleClient, sender: WearDataSender) {
    var connected by remember { mutableStateOf(false) }
    var latest by remember { mutableStateOf<ErgSample?>(null) }
    var machine by remember { mutableStateOf(MachineType.SKI) }
    var phase by remember { mutableStateOf(Phase.IDLE) }
    var startMs by remember { mutableStateOf(0L) }
    var startIso by remember { mutableStateOf("") }

    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { grants ->
        if (grants.values.all { it }) {
            ble.start(object : Pm5BleClient.Listener {
                override fun onConnected() { connected = true }
                override fun onDisconnected() { connected = false }
                override fun onSamples(samples: List<ErgSample>) { latest = samples.lastOrNull() }
            })
        }
    }

    fun startRecording() {
        ble.resetSamples()
        startMs = System.currentTimeMillis()
        startIso = Instant.now().toString()
        phase = Phase.RECORDING
    }

    fun finishRecording() {
        val elapsedMs = System.currentTimeMillis() - startMs
        val station = if (machine == MachineType.SKI) Stations.byKey("ski")!! else Stations.byKey("row")!!
        val segment = RecordedSegment(
            kind = "station",
            splitTimeMs = elapsedMs,
            exerciseId = station.exerciseId,
            machineType = machine.wire,
            ergSamples = ble.snapshot(),
        )
        val session = SessionAssembler.assemble(
            sessionId = UUID.randomUUID().toString(),
            startedAtIso = startIso,
            clientUpdatedAtIso = Instant.now().toString(),
            endedAtIso = Instant.now().toString(),
            segments = listOf(segment),
        )
        sender.sendSession(session)
        phase = Phase.SENT
    }

    MaterialTheme {
        Column(
            modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(10.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            when {
                !connected -> {
                    Text("PM5 검색 중…")
                    Chip(
                        onClick = { launcher.launch(blePermissions()) },
                        label = { Text("연결") },
                        colors = ChipDefaults.primaryChipColors(),
                    )
                }
                phase == Phase.RECORDING -> {
                    val s = latest
                    Text("${s?.watts ?: 0} W")
                    Text("spm ${s?.spm ?: 0} · ${machine.wire}")
                    Chip(
                        onClick = { finishRecording() },
                        label = { Text("종료·전송") },
                        colors = ChipDefaults.primaryChipColors(),
                    )
                }
                phase == Phase.SENT -> {
                    Text("전송됨 ✓")
                    Chip(
                        onClick = { phase = Phase.IDLE },
                        label = { Text("새 기록") },
                        colors = ChipDefaults.secondaryChipColors(),
                    )
                }
                else -> { // IDLE, connected
                    Text("PM5 연결됨")
                    Chip(
                        onClick = { machine = if (machine == MachineType.SKI) MachineType.ROW else MachineType.SKI },
                        label = { Text(if (machine == MachineType.SKI) "스키" else "로잉") },
                        colors = ChipDefaults.secondaryChipColors(),
                    )
                    Chip(
                        onClick = { startRecording() },
                        label = { Text("시작") },
                        colors = ChipDefaults.primaryChipColors(),
                    )
                }
            }
        }
    }
}
