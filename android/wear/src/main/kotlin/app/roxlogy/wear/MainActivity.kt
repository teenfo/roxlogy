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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import app.roxlogy.shared.ingest.ErgSample
import app.roxlogy.wear.ble.Pm5BleClient

/**
 * N2 워치 화면 — PM5 연결 후 실시간 파워/페이스/스트로크레이트 표시.
 * 파싱은 N1(C2Pm)로 검증됨. 이 화면의 BLE 런타임은 실기(워치+PM5)로 확인한다.
 */
class MainActivity : ComponentActivity() {

    private lateinit var ble: Pm5BleClient

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ble = Pm5BleClient(this)
        setContent { WearApp(ble) }
    }

    override fun onDestroy() {
        ble.stop()
        super.onDestroy()
    }
}

private fun blePermissions(): Array<String> =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
    } else {
        arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
    }

@Composable
fun WearApp(ble: Pm5BleClient) {
    var connected by remember { mutableStateOf(false) }
    var latest by remember { mutableStateOf<ErgSample?>(null) }

    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { grants ->
        if (grants.values.all { it }) {
            ble.start(object : Pm5BleClient.Listener {
                override fun onConnected() { connected = true }
                override fun onDisconnected() { connected = false }
                override fun onSamples(samples: List<ErgSample>) {
                    latest = samples.lastOrNull()
                }
            })
        }
    }

    LaunchedEffect(Unit) { launcher.launch(blePermissions()) }

    MaterialTheme {
        Column(
            modifier = Modifier.fillMaxSize().padding(8.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(text = if (connected) "PM5 연결됨" else "PM5 검색 중…")
            val s = latest
            if (s != null) {
                Text(text = "${s.watts ?: 0} W")
                Text(text = "spm ${s.spm ?: 0}")
                Text(text = "pace ${s.pace?.let { formatPace(it) } ?: "--"}")
            }
        }
    }
}

/** 초/500m → m:ss/500m */
private fun formatPace(sec: Double): String {
    val total = sec.toInt()
    val m = total / 60
    val s = total % 60
    return "$m:${s.toString().padStart(2, '0')}"
}
