package app.roxlogy.wear.ble

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothStatusCodes
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
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
 * Concept2 PM Bluetooth Smart Interface Definition 기준:
 *  - PM 은 **Discovery 서비스(CE060000-…)만 광고**한다. Rowing 서비스(CE060030-…)는
 *    연결 후 GATT 에서만 보이므로 스캔 필터로 쓰면 기기가 잡히지 않는다.
 *  - 펌웨어/OS 조합에 따라 서비스 UUID 가 광고가 아닌 스캔응답에 실리기도 해서,
 *    여기서는 필터 없이 스캔한 뒤 광고 UUID 또는 이름(PM3/PM4/PM5)으로 직접 매칭한다.
 *  - **PM 은 화면만 깨워서는 광고하지 않는다.** 사용자가 PM5 에서 Menu → Connect 를
 *    눌러야 광고가 시작된다(실기기 확인 + ErgData/ErgZone 연동 가이드 공통 절차).
 *    그래서 스캔 타임아웃을 30초로 잡아 메뉴를 여는 시간을 준다.
 *  - 페어링(본딩) 불필요 — GATT 직결.
 *
 * 파싱 정확성은 N1 유닛테스트로 검증됨. 권한(BLUETOOTH_SCAN/CONNECT)은 호출측에서 확인.
 */
@SuppressLint("MissingPermission")
class Pm5BleClient(private val context: Context) {

    interface Listener {
        fun onConnected() {}
        fun onDisconnected() {}
        fun onSamples(samples: List<ErgSample>) {}
        /** 스캔 실패·타임아웃·GATT 오류 — UI 가 "연결 중…"에 갇히지 않도록 알린다. */
        fun onFailed(reason: String) {}
    }

    private val cccd = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    private val discoveryUuid = ParcelUuid(UUID.fromString(C2Pm.DISCOVERY_SERVICE))
    private val rowingParcelUuid = ParcelUuid(UUID.fromString(C2Pm.ROWING_SERVICE))
    private val serviceUuid = UUID.fromString(C2Pm.ROWING_SERVICE)
    // 1Hz 상태 3종 + 스트로크·스플릿·힘곡선. 스트로크/스플릿 계열은 이벤트가 있을 때만
    // (스트로크 종료·인터벌 종료) 알림이 오므로 상시 트래픽이 늘지는 않는다.
    private val statusUuid = UUID.fromString(C2Pm.GENERAL_STATUS)
    private val addStatus1Uuid = UUID.fromString(C2Pm.ADDITIONAL_STATUS_1)
    private val addStatus2Uuid = UUID.fromString(C2Pm.ADDITIONAL_STATUS_2)
    private val strokeUuid = UUID.fromString(C2Pm.STROKE_DATA)
    private val addStrokeUuid = UUID.fromString(C2Pm.ADDITIONAL_STROKE_DATA)
    private val splitUuid = UUID.fromString(C2Pm.SPLIT_INTERVAL_DATA)
    private val addSplitUuid = UUID.fromString(C2Pm.ADDITIONAL_SPLIT_INTERVAL_DATA)
    private val forceCurveUuid = UUID.fromString(C2Pm.FORCE_CURVE)
    private val multiplexUuid = UUID.fromString(C2Pm.MULTIPLEXED)
    private val subscribeUuids = listOf(
        statusUuid, addStatus1Uuid, addStatus2Uuid,
        strokeUuid, addStrokeUuid, splitUuid, addSplitUuid, forceCurveUuid,
    )

    private val manager by lazy {
        context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    }
    private val accumulator = C2ErgAccumulator()
    private val forceCurve = C2Pm.ForceCurveAssembler()
    private var gatt: BluetoothGatt? = null
    private var listener: Listener? = null
    private val handler = Handler(Looper.getMainLooper())

    // CCCD 쓰기는 직렬화 필요 — 큐로 하나씩 처리
    private val subscribeQueue = ArrayDeque<BluetoothGattCharacteristic>()

    // 스캔 결과를 잠시 모아 RSSI 최강 기기에 연결 (짐에 PM5가 여러 대일 때 가장
    // 가까운 — 사용자가 앉아 있는 — 머신을 고르기 위함)
    private val candidates = HashMap<String, Pair<BluetoothDevice, Int>>()

    /** 스캔에서 본 주변 PM — 실패 화면 목록·수동 선택 연결용. */
    data class NearbyPm(val name: String, val mac: String, val rssi: Int, val remembered: Boolean)

    // 스캔 진단 — 주변에서 본 BLE 기기(주소 → 이름). 실패 사유에 요약해 노출한다.
    private val seen = LinkedHashMap<String, String>()
    // PM 매칭된 기기(주소 → 이름/RSSI) — fail 후에도 유지해 목록으로 보여준다
    private val pmSeen = LinkedHashMap<String, Pair<String, Int>>()
    private var picking = false
    private var scanning = false
    private var discovering = false
    private var ready = false // GATT 링크 + 로잉 서비스 확인 = 연결됨
    private var retried = false
    private var writeRetries = 0
    private var target: BluetoothDevice? = null
    private var targetName: String? = null
    private var preferMac: String? = null

    // 진단 — 특성별 수신 프레임 수·구독 포기 목록·힘곡선 청크 수 (0x003C 0건 원인 추적)
    private val notifCounts = LinkedHashMap<String, Int>()
    private val subGiveUps = mutableListOf<String>()
    private var fcChunks = 0
    private var connMode = "?" // "MUX" | "개별" — 서비스 탐색 시 확정
    private var has3C: Boolean? = null // 이 PM5 펌웨어에 힘곡선 특성이 존재하는지

    private fun shortId(uuid: UUID): String = uuid.toString().substring(4, 8).uppercase()

    /** 수신 진단 요약 — "MUX·3C있음 · 0031:22 … · 곡선청크 0 · 구독포기 없음" 식. */
    fun diag(): String {
        val counts = subscribeUuids.joinToString(" ") { u ->
            "${shortId(u)}:${notifCounts[shortId(u)] ?: 0}"
        }
        val giveUp = if (subGiveUps.isEmpty()) "없음" else subGiveUps.joinToString(",")
        val cap3C = when (has3C) { true -> "3C있음"; false -> "3C없음"; null -> "3C?" }
        return "$connMode·$cap3C · $counts · 곡선청크 $fcChunks/조립 ${accumulator.forceCurveSnapshot().size} · 구독포기 $giveUp"
    }

    /** 스캔·연결 시작. 기존 연결이 있으면 정리 후 새로 스캔 (기기 전환 안전).
     *  [preferMac] — 기억해 둔 PM5 주소. 스캔에서 보이면 RSSI 대기 없이 즉시 연결하고,
     *  안 보이면 기존 RSSI 최강 선택으로 폴백한다 (짐에서 다른 머신을 써도 안전). */
    fun start(listener: Listener, preferMac: String? = null) {
        stop()
        this.listener = listener
        this.preferMac = preferMac
        accumulator.clear()
        retried = false
        seen.clear()
        pmSeen.clear()
        notifCounts.clear()
        subGiveUps.clear()
        fcChunks = 0
        connMode = "?"
        has3C = null
        scan()
    }

    private fun scan() {
        val scanner = manager.adapter?.bluetoothLeScanner
        if (scanner == null) {
            fail("블루투스가 꺼져 있습니다")
            return
        }
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()
        // 필터 없이 스캔하고 아래에서 직접 매칭 — 광고/스캔응답 어디에 UUID 가 실려도 잡는다
        scanning = true
        scanner.startScan(null, settings, scanCallback)
        handler.postDelayed(scanTimeout, SCAN_TIMEOUT_MS)
    }

    private val scanTimeout = Runnable {
        if (scanning && candidates.isEmpty()) {
            stopScan()
            fail(notFoundReason())
        }
    }

    /** 스캔 실패 사유 — 주변 BLE 를 몇 대 봤는지까지 알려 원인을 좁힌다. */
    private fun notFoundReason(): String = when {
        seen.isEmpty() ->
            "PM5를 찾지 못함 · 주변 BLE 0대 — 블루투스/권한을 확인하세요"
        else -> {
            val names = seen.values.filter { it != "(이름없음)" }.take(3).joinToString(", ")
            "PM5를 찾지 못함 · 주변 ${seen.size}대 검색됨" +
                (if (names.isNotEmpty()) " ($names)" else "") +
                " — PM5에서 Menu → Connect 를 연 뒤 다시 시도하세요"
        }
    }

    /** 이미 연결/스캔 중일 때만 재스캔 — 머신 스테이션 전환(스키↔로잉) 시 호출.
     *  아직 한 번도 연결 안 했으면 아무것도 안 함 (권한 요청은 사용자 탭으로만).
     *  재스캔을 시작했으면 true (호출측이 연결 표시를 끌 수 있게). */
    fun restartIfStarted(): Boolean {
        val l = listener ?: return false
        if (gatt == null && !scanning) return false
        start(l)
        return true
    }

    fun stop() {
        handler.removeCallbacksAndMessages(null)
        picking = false
        discovering = false
        ready = false
        writeRetries = 0
        target = null
        candidates.clear()
        subscribeQueue.clear()
        stopScan()
        gatt?.disconnect()
        gatt?.close()
        gatt = null
    }

    private fun stopScan() {
        if (!scanning) return
        scanning = false
        runCatching { manager.adapter?.bluetoothLeScanner?.stopScan(scanCallback) }
    }

    /** 실패 통지 + 상태 정리 — 다음 탭에서 깨끗하게 다시 시도할 수 있게. */
    private fun fail(reason: String) {
        handler.removeCallbacksAndMessages(null)
        picking = false
        discovering = false
        ready = false
        writeRetries = 0
        candidates.clear()
        subscribeQueue.clear()
        stopScan()
        gatt?.close()
        gatt = null
        listener?.onFailed(reason)
    }

    /** PM 판별: 광고 서비스 UUID(Discovery/Rowing) 또는 기기 이름 프리픽스. */
    private fun isPm(result: ScanResult): Boolean {
        val uuids = result.scanRecord?.serviceUuids
        if (uuids != null && (discoveryUuid in uuids || rowingParcelUuid in uuids)) return true
        val name = result.scanRecord?.deviceName ?: runCatching { result.device.name }.getOrNull()
        return name != null && NAME_PREFIXES.any { name.startsWith(it, ignoreCase = true) }
    }

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            // 진단용: PM 이 아니어도 본 기기를 세어둔다. 0대면 권한/어댑터 문제,
            // N대인데 매칭 0이면 광고 UUID·이름 문제 — 실패 문구로 구분해 알린다.
            if (seen.size < SEEN_CAP) {
                val nm = result.scanRecord?.deviceName ?: runCatching { result.device.name }.getOrNull()
                seen[result.device.address] = nm ?: "(이름없음)"
            }
            if (!isPm(result)) return
            val nm = result.scanRecord?.deviceName
                ?: runCatching { result.device.name }.getOrNull() ?: "PM5"
            val prevPm = pmSeen[result.device.address]
            if (prevPm == null || result.rssi > prevPm.second) {
                pmSeen[result.device.address] = nm to result.rssi
            }
            // 기억해 둔 기기가 보이면 후보 수집을 건너뛰고 즉시 연결
            if (preferMac != null && result.device.address == preferMac) {
                picking = false
                stopScan()
                handler.removeCallbacks(scanTimeout)
                candidates.clear()
                targetName = result.scanRecord?.deviceName
                    ?: runCatching { result.device.name }.getOrNull()
                connect(result.device)
                return
            }
            val prev = candidates[result.device.address]
            if (prev == null || result.rssi > prev.second) {
                candidates[result.device.address] = result.device to result.rssi
            }
            if (!picking) {
                picking = true
                handler.postDelayed({ pickBest() }, PICK_WINDOW_MS)
            }
        }

        override fun onBatchScanResults(results: MutableList<ScanResult>) {
            results.forEach { onScanResult(ScanSettings.CALLBACK_TYPE_ALL_MATCHES, it) }
        }

        override fun onScanFailed(errorCode: Int) {
            scanning = false
            fail("BLE 스캔 실패 (코드 $errorCode)")
        }
    }

    private fun pickBest() {
        picking = false
        stopScan()
        handler.removeCallbacks(scanTimeout)
        val best = candidates.values.maxByOrNull { it.second }?.first
        candidates.clear()
        if (best == null) {
            fail(notFoundReason())
            return
        }
        targetName = seen[best.address].takeIf { it != "(이름없음)" }
            ?: runCatching { best.name }.getOrNull()
        connect(best)
    }

    /** 기록 중 끊긴 연결을 수동 개입 없이 복구 — autoConnect=true 는 대상 기기가
     *  다시 광고를 시작하는 순간 OS 가 연결해 준다(타임아웃 없음, stop()으로 취소). */
    private fun autoReconnect() {
        val device = target ?: return
        discovering = false
        writeRetries = 0
        gatt?.close()
        gatt = device.connectGatt(context, true, gattCallback, BluetoothDevice.TRANSPORT_LE)
    }

    private fun connect(device: BluetoothDevice) {
        target = device
        discovering = false
        ready = false
        gatt = device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
        handler.postDelayed(connectTimeout, CONNECT_TIMEOUT_MS)
    }

    // 구독 완료(ready) 전에 시간이 다 가면 재시도 — status 133 등 첫 연결 실패가 흔하다
    private val connectTimeout = Runnable {
        if (!ready) retryOrFail("PM5 연결이 지연됩니다 — 다시 시도하세요")
    }

    private fun retryOrFail(reason: String) {
        val device = target
        gatt?.close()
        gatt = null
        if (!retried && device != null) {
            retried = true // status 133 등 첫 실패는 흔해서 1회 재시도
            handler.postDelayed({ connect(device) }, RETRY_DELAY_MS)
        } else {
            fail(reason)
        }
    }

    private val gattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS && newState != BluetoothProfile.STATE_CONNECTED) {
                handler.removeCallbacks(connectTimeout)
                if (ready) { // 기록 중 끊김 — PM 이 재광고하면 OS 가 알아서 다시 붙는다
                    ready = false
                    listener?.onDisconnected()
                    autoReconnect()
                    return
                }
                retryOrFail("PM5 연결 실패 (status $status)")
                return
            }
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    handler.removeCallbacks(connectTimeout)
                    // MTU 상향(상태 특성이 20바이트라 기본 MTU 로는 여유가 없다) 후 서비스 탐색.
                    // 콜백이 안 오는 기기가 있어 타임아웃 폴백을 함께 건다.
                    handler.post { g.requestMtu(MTU) }
                    handler.postDelayed({ discover(g) }, MTU_FALLBACK_MS)
                    handler.postDelayed(connectTimeout, CONNECT_TIMEOUT_MS)
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    handler.removeCallbacks(connectTimeout)
                    val wasReady = ready
                    ready = false
                    listener?.onDisconnected()
                    if (wasReady) autoReconnect()
                }
            }
        }

        override fun onMtuChanged(g: BluetoothGatt, mtu: Int, status: Int) {
            discover(g)
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            handler.removeCallbacks(connectTimeout)
            if (status != BluetoothGatt.GATT_SUCCESS) {
                retryOrFail("PM5 서비스 탐색 실패 (status $status)")
                return
            }
            val service = g.getService(serviceUuid)
            if (service == null) {
                fail("PM5 로잉 서비스를 찾지 못했습니다")
                return
            }
            subscribeQueue.clear()
            // 멀티플렉스(0x0080)가 있으면 그것을 구독하고, 힘곡선(0x003C)은 존재하면
            // 병행 구독한다 — 펌웨어별로 곡선이 mux 로만 오거나 개별로만 오는 편차 대비.
            // mux 가 없으면 개별 특성 전체로 폴백.
            val mux = service.getCharacteristic(multiplexUuid)
            val fc = service.getCharacteristic(forceCurveUuid)
            has3C = fc != null
            connMode = if (mux != null) "MUX" else "개별"
            if (mux != null) {
                subscribeQueue.add(mux)
                fc?.let { subscribeQueue.add(it) }
            } else {
                for (u in subscribeUuids) service.getCharacteristic(u)?.let { subscribeQueue.add(it) }
            }
            if (subscribeQueue.isEmpty()) {
                fail("PM5 상태 특성을 찾지 못했습니다")
                return
            }
            // GATT 링크 + 로잉 서비스 확인 = 연결 완료. 알림 구독은 이어서 진행하되,
            // 여기서 바로 통지해야 PM5 는 연결됐는데 화면만 "검색 중"에 남는 일이 없다.
            ready = true
            writeRetries = 0
            listener?.onConnected()
            subscribeNext(g)
        }

        override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                fail("PM5 알림 구독 실패 (status $status)")
                return
            }
            writeRetries = 0
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

    /** 서비스 탐색은 한 번만 (MTU 콜백과 폴백 타이머가 겹칠 수 있다). */
    private fun discover(g: BluetoothGatt) {
        if (discovering) return
        discovering = true
        g.discoverServices()
    }

    private fun handleFrame(uuid: UUID, bytes: ByteArray) {
        // 멀티플렉스 프레임: [특성 ID 1바이트][해당 특성 페이로드] → 개별 특성으로 라우팅
        if (uuid == multiplexUuid) {
            if (bytes.isEmpty()) return
            val mapped = when (bytes[0].toInt() and 0xFF) {
                0x31 -> statusUuid
                0x32 -> addStatus1Uuid
                0x33 -> addStatus2Uuid
                0x35 -> strokeUuid
                0x36 -> addStrokeUuid
                0x37 -> splitUuid
                0x38 -> addSplitUuid
                0x3C -> forceCurveUuid
                else -> return
            }
            handleFrame(mapped, bytes.copyOfRange(1, bytes.size))
            return
        }
        notifCounts.merge(shortId(uuid), 1, Int::plus)
        if (uuid == forceCurveUuid) fcChunks++
        try {
            when (uuid) {
                statusUuid -> accumulator.onGeneralStatus(C2Pm.parseGeneralStatus(bytes))
                addStatus1Uuid -> accumulator.onAdditionalStatus1(C2Pm.parseAdditionalStatus1(bytes))
                addStatus2Uuid -> accumulator.onAdditionalStatus2(C2Pm.parseAdditionalStatus2(bytes))
                strokeUuid -> accumulator.onStroke(C2Pm.parseStrokeData(bytes))
                addStrokeUuid -> accumulator.onAdditionalStroke(C2Pm.parseAdditionalStrokeData(bytes))
                splitUuid -> accumulator.onSplit(C2Pm.parseSplitIntervalData(bytes))
                addSplitUuid -> accumulator.onAdditionalSplit(C2Pm.parseAdditionalSplitIntervalData(bytes))
                forceCurveUuid -> forceCurve.onChunk(bytes)?.let { accumulator.onForceCurve(it) }
                else -> return
            }
            listener?.onSamples(accumulator.snapshot())
        } catch (_: IllegalArgumentException) {
            // 길이 미달 프레임은 무시 (펌웨어별 편차)
        }
    }

    /**
     * CCCD 쓰기는 한 번에 하나만 — Android GATT 는 동시 요청을 조용히 버린다.
     * 큐가 빌 때까지 onDescriptorWrite 콜백으로 이어 달린다.
     *
     * 쓰기 요청이 큐 혼잡으로 거부되면(false / != SUCCESS) 콜백이 아예 오지 않으므로
     * 반환값을 보고 같은 특성을 짧게 재시도한다 — 이걸 안 보면 구독이 조용히 멈춘다.
     */
    private fun subscribeNext(g: BluetoothGatt) {
        while (true) {
            val c = subscribeQueue.peek() ?: return // 모두 완료
            g.setCharacteristicNotification(c, true)
            val descriptor = c.getDescriptor(cccd)
            if (descriptor == null) { // CCCD 없으면 건너뜀
                subscribeQueue.poll()
                continue
            }
            val enable = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
            val ok = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                g.writeDescriptor(descriptor, enable) == BluetoothStatusCodes.SUCCESS
            } else {
                @Suppress("DEPRECATION")
                descriptor.value = enable
                @Suppress("DEPRECATION")
                g.writeDescriptor(descriptor)
            }
            if (ok) {
                subscribeQueue.poll() // 콜백에서 다음 특성으로
                return
            }
            if (++writeRetries > MAX_WRITE_RETRIES) {
                subGiveUps.add(shortId(c.uuid)) // 진단에 노출 — 조용한 포기가 0건 수신의 유력 원인
                subscribeQueue.poll() // 이 특성은 포기하고 나머지라도 구독
                writeRetries = 0
                continue
            }
            handler.postDelayed({ gatt?.let { subscribeNext(it) } }, WRITE_RETRY_MS)
            return
        }
    }

    /** 마지막 스캔에서 본 주변 PM 목록(RSSI 내림차순) — 실패 화면·수동 선택용. */
    fun nearbyPm5(rememberedMac: String? = null): List<NearbyPm> =
        pmSeen.entries
            .map { (mac, v) -> NearbyPm(v.first, mac, v.second, mac == rememberedMac) }
            .sortedByDescending { it.rssi }

    /** 스캔 취소 — 실패 통지 없이 조용히 멈춘다("검색 중지" 버튼). */
    fun cancelScan() {
        handler.removeCallbacksAndMessages(null)
        picking = false
        stopScan()
    }

    /** 연결(시도) 중인 PM5 의 MAC — 연결 성공 후 기억용. */
    fun deviceAddress(): String? = target?.address

    /** 연결된 PM5 이름(시리얼 포함, 예: "PM5 430123456") — 어느 모니터인지 확인용. */
    fun deviceName(): String? = targetName

    /** 현재까지 누적된 세그먼트 샘플 (세그먼트 종료 시 조립에 사용). */
    fun snapshot(): List<ErgSample> = accumulator.snapshot()

    /** PM5 확장 데이터 — 스트로크/스플릿/힘곡선. */
    fun strokeSnapshot() = accumulator.strokeSnapshot()
    fun splitSnapshot() = accumulator.splitSnapshot()
    fun forceCurveSnapshot() = accumulator.forceCurveSnapshot()

    /** 세그먼트 기록 시작 시 누적 초기화 — 이전 스테이션/워밍업 샘플 유입 방지. */
    fun resetSamples() {
        accumulator.clear()
        forceCurve.clear()
    }

    private companion object {
        const val PICK_WINDOW_MS = 1500L
        const val SCAN_TIMEOUT_MS = 30_000L // PM5 메뉴(Connect)를 여는 시간 포함
        const val CONNECT_TIMEOUT_MS = 12_000L
        const val MTU_FALLBACK_MS = 1200L
        const val RETRY_DELAY_MS = 600L
        const val WRITE_RETRY_MS = 150L
        const val MAX_WRITE_RETRIES = 8
        const val MTU = 247
        const val SEEN_CAP = 30
        val NAME_PREFIXES = listOf("PM5", "PM4", "PM3", "Concept2")
    }
}
