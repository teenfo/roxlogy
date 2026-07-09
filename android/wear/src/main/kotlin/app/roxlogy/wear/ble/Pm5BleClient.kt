package app.roxlogy.wear.ble

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.ParcelUuid
import app.roxlogy.shared.ble.C2ErgAccumulator
import app.roxlogy.shared.ble.C2Pm
import app.roxlogy.shared.ingest.ErgSample
import java.util.ArrayDeque
import java.util.UUID

/**
 * PM5(스키/로잉) BLE 연결·구독 클라이언트.
 * 스캔 → 연결 → General/Additional 1·2 특성 알림 구독 → N1 파서(C2Pm)로 파싱해
 * C2ErgAccumulator에 누적, 콜백으로 최신 샘플 스트림을 전달한다.
 *
 * 파싱 정확성은 N1 유닛테스트로 검증됨 — 이 파일은 BLE 런타임 "배관"이며 최종 동작은
 * 실기(워치+PM5)로 확인한다. 권한(BLUETOOTH_SCAN/CONNECT)은 호출측에서 런타임 확인.
 */
@SuppressLint("MissingPermission")
class Pm5BleClient(private val context: Context) {

    interface Listener {
        fun onConnected() {}
        fun onDisconnected() {}
        fun onSamples(samples: List<ErgSample>) {}
    }

    private val cccd = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    private val serviceUuid = UUID.fromString(C2Pm.ROWING_SERVICE)
    private val subscribeUuids = listOf(
        UUID.fromString(C2Pm.GENERAL_STATUS),
        UUID.fromString(C2Pm.ADDITIONAL_STATUS_1),
        UUID.fromString(C2Pm.ADDITIONAL_STATUS_2),
    )

    private val manager by lazy {
        context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    }
    private val accumulator = C2ErgAccumulator()
    private var gatt: BluetoothGatt? = null
    private var listener: Listener? = null

    // CCCD 쓰기는 직렬화 필요 — 큐로 하나씩 처리
    private val subscribeQueue = ArrayDeque<BluetoothGattCharacteristic>()

    fun start(listener: Listener) {
        this.listener = listener
        accumulator.clear()
        val scanner = manager.adapter?.bluetoothLeScanner ?: return
        val filter = ScanFilter.Builder()
            .setServiceUuid(ParcelUuid(serviceUuid))
            .build()
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()
        scanner.startScan(listOf(filter), settings, scanCallback)
    }

    fun stop() {
        manager.adapter?.bluetoothLeScanner?.stopScan(scanCallback)
        gatt?.disconnect()
        gatt?.close()
        gatt = null
    }

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            manager.adapter?.bluetoothLeScanner?.stopScan(this)
            connect(result.device)
        }
    }

    private fun connect(device: BluetoothDevice) {
        gatt = device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
    }

    private val gattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> g.discoverServices()
                BluetoothProfile.STATE_DISCONNECTED -> listener?.onDisconnected()
            }
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) return
            val service = g.getService(serviceUuid) ?: return
            subscribeQueue.clear()
            for (u in subscribeUuids) service.getCharacteristic(u)?.let { subscribeQueue.add(it) }
            listener?.onConnected()
            subscribeNext(g)
        }

        override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) {
            subscribeNext(g) // 다음 특성 구독
        }

        // API 33+ (value 파라미터 제공)
        override fun onCharacteristicChanged(
            g: BluetoothGatt,
            c: BluetoothGattCharacteristic,
            value: ByteArray,
        ) {
            handleFrame(c.uuid, value)
        }

        // API 32 이하 (deprecated) — 두 버전 모두 오버라이드해야 전 SDK에서 알림 수신
        @Deprecated("Deprecated in Java")
        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
            @Suppress("DEPRECATION")
            handleFrame(c.uuid, c.value ?: return)
        }
    }

    private fun handleFrame(uuid: UUID, bytes: ByteArray) {
        try {
            when (uuid) {
                subscribeUuids[0] -> accumulator.onGeneralStatus(C2Pm.parseGeneralStatus(bytes))
                subscribeUuids[1] -> accumulator.onAdditionalStatus1(C2Pm.parseAdditionalStatus1(bytes))
                subscribeUuids[2] -> accumulator.onAdditionalStatus2(C2Pm.parseAdditionalStatus2(bytes))
            }
            listener?.onSamples(accumulator.snapshot())
        } catch (_: IllegalArgumentException) {
            // 길이 미달 프레임은 무시 (펌웨어별 편차)
        }
    }

    private fun subscribeNext(g: BluetoothGatt) {
        val c = subscribeQueue.poll() ?: return
        g.setCharacteristicNotification(c, true)
        val descriptor = c.getDescriptor(cccd) ?: return
        @Suppress("DEPRECATION")
        descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
        @Suppress("DEPRECATION")
        g.writeDescriptor(descriptor)
    }

    /** 현재까지 누적된 세션 샘플 (세그먼트 종료 시 조립에 사용). */
    fun snapshot(): List<ErgSample> = accumulator.snapshot()

    /** 세그먼트 기록 시작 시 누적 초기화. */
    fun resetSamples() = accumulator.clear()
}
