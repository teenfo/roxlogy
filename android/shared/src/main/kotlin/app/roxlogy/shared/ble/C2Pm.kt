package app.roxlogy.shared.ble

/**
 * Concept2 PM5 BLE (Concept2 PM Bluetooth Smart Interface Definition) 파서.
 *
 * 모든 다중바이트 필드는 **리틀엔디언**. 오프셋/스케일은 C2 공식 스펙 기준으로
 * 아래 상수/주석에 명시했다 — 실기 검증(N2) 전 공식 PDF와 교차 확인 가능.
 * 이 파일은 **순수 Kotlin**이라 하드웨어 없이 CI 유닛테스트로 파싱 정확성을 검증한다.
 *
 * ErgSample(t, dist, pace, spm, watts, cal) 채우기에 필요한 소스:
 *  - General Status(0x0031): 경과시간, 거리
 *  - Additional Status 1(0x0032): 스트로크레이트(spm), 현재 페이스, 심박
 *  - Additional Status 2(0x0033): 평균 파워(W), 총 칼로리
 */
object C2Pm {

    /** UUID 베이스: xxxxxxxx-43E5-11E4-916C-0800200C9A66 */
    private fun uuid(short: String) = "CE06$short-43E5-11E4-916C-0800200C9A66"

    /**
     * Discovery(광고) 서비스 — PM 이 **광고 패킷에 싣는 유일한** 서비스 UUID.
     * 스캔 필터·매칭은 반드시 이것으로 해야 한다. Rowing 서비스(0030)는 연결 후
     * GATT 에서만 보이며 광고에는 없다 — 이걸로 필터하면 기기가 영영 안 잡힌다.
     */
    val DISCOVERY_SERVICE: String = uuid("0000")
    val INFORMATION_SERVICE: String = uuid("0010")
    val CONTROL_SERVICE: String = uuid("0020")

    // Rowing 서비스 및 특성 UUID (구독 대상)
    val ROWING_SERVICE: String = uuid("0030")
    val GENERAL_STATUS: String = uuid("0031")
    val ADDITIONAL_STATUS_1: String = uuid("0032")
    val ADDITIONAL_STATUS_2: String = uuid("0033")
    val STROKE_DATA: String = uuid("0035")
    val ADDITIONAL_STROKE_DATA: String = uuid("0036")
    val SPLIT_INTERVAL_DATA: String = uuid("0037")
    val ADDITIONAL_SPLIT_INTERVAL_DATA: String = uuid("0038")
    val FORCE_CURVE: String = uuid("003C")

    // 멀티플렉스 특성 — 모든 데이터를 [특성 ID 1바이트][해당 특성 페이로드] 로 한 채널에
    // 실어 보낸다. 일부 PM5 펌웨어는 개별 0x003C 로 힘 곡선 알림을 보내지 않으므로
    // (실기기 진단: 구독 성공에도 003C 0건) 이 채널이 힘 곡선의 사실상 유일 경로.
    val MULTIPLEXED: String = uuid("0080")

    // ---- 리틀엔디언 언사인드 판독 헬퍼 ----
    private fun ByteArray.u8(i: Int): Int = this[i].toInt() and 0xFF
    private fun ByteArray.u16(i: Int): Int = u8(i) or (u8(i + 1) shl 8)
    private fun ByteArray.u24(i: Int): Int = u8(i) or (u8(i + 1) shl 8) or (u8(i + 2) shl 16)

    // ---- 파싱 결과 ----
    data class GeneralStatus(
        val elapsedTimeMs: Long,   // 0.01s → ms
        val distanceM: Double,     // 0.1m
        val workoutState: Int,
        val rowingState: Int,
        val strokeState: Int,
        val dragFactor: Int,
    )

    data class AdditionalStatus1(
        val elapsedTimeMs: Long,       // 0.01s → ms
        val speedMps: Double,          // 0.001 m/s
        val strokeRate: Int,           // spm
        val heartRate: Int?,           // bpm (255 = 무효 → null)
        val currentPaceSecPer500: Double, // 0.01s → s / 500m
        val avgPaceSecPer500: Double,
    )

    data class AdditionalStatus2(
        val elapsedTimeMs: Long,       // 0.01s → ms
        val intervalCount: Int,
        val avgPowerW: Int,            // watts
        val totalCalories: Int,        // cal
        val splitAvgPaceSecPer500: Double, // 0.01s
        val splitAvgPowerW: Int,
    )

    data class StrokeData(
        val elapsedTimeMs: Long,       // 0.01s → ms
        val distanceM: Double,         // 0.1m
        val strokeCount: Int,
        val avgDriveForceLbs: Double,  // 0.1 lbs
        val workPerStrokeJ: Double,    // 0.1 J
        val driveLengthM: Double,      // 0.01 m
        val driveTimeMs: Long,         // 0.01s → ms
        val recoveryTimeMs: Long,      // 0.01s → ms
        val strokeDistanceM: Double,   // 0.01 m
        val peakDriveForceLbs: Double, // 0.1 lbs
    )

    /** 0x0036 Additional Stroke Data */
    data class AdditionalStrokeData(
        val elapsedTimeMs: Long,       // 0.01s → ms
        val strokePowerW: Int,         // watts
        val strokeCaloriesPerHr: Int,  // cal/hr
        val strokeCount: Int,
        val projectedWorkTimeMs: Long, // s → ms
        val projectedWorkDistanceM: Int,
    )

    /** 0x0037 Split/Interval Data */
    data class SplitIntervalData(
        val elapsedTimeMs: Long,       // 0.01s → ms
        val distanceM: Double,         // 0.1 m
        val splitTimeMs: Long,         // 0.01s → ms
        val splitDistanceM: Int,
        val restTimeMs: Long,          // 0.01s → ms
        val restDistanceM: Int,
        val type: Int,
        val intervalNumber: Int,
    )

    /** 0x0038 Additional Split/Interval Data */
    data class AdditionalSplitIntervalData(
        val elapsedTimeMs: Long,       // 0.01s → ms
        val strokeRate: Int,           // spm
        val workHeartRate: Int?,       // bpm (255 = 무효)
        val restHeartRate: Int?,       // bpm (255 = 무효)
        val avgPaceSecPer500: Double,  // 0.01s
        val totalCalories: Int,
        val avgCaloriesPerHr: Int,
        val speedMps: Double,          // 0.001 m/s
        val powerW: Int,
        val avgDragFactor: Int,
        val intervalNumber: Int,
    )

    /** 0x0031 General Status (>=19 bytes) */
    fun parseGeneralStatus(b: ByteArray): GeneralStatus {
        require(b.size >= 19) { "General Status needs >=19 bytes, got ${b.size}" }
        return GeneralStatus(
            elapsedTimeMs = b.u24(0) * 10L,
            distanceM = b.u24(3) * 0.1,
            workoutState = b.u8(8),
            rowingState = b.u8(9),
            strokeState = b.u8(10),
            dragFactor = b.u8(18),
        )
    }

    /** 0x0032 Additional Status 1 (>=11 bytes) */
    fun parseAdditionalStatus1(b: ByteArray): AdditionalStatus1 {
        require(b.size >= 11) { "Additional Status 1 needs >=11 bytes, got ${b.size}" }
        val hr = b.u8(6)
        return AdditionalStatus1(
            elapsedTimeMs = b.u24(0) * 10L,
            speedMps = b.u16(3) * 0.001,
            strokeRate = b.u8(5),
            heartRate = if (hr == 255) null else hr,
            currentPaceSecPer500 = b.u16(7) * 0.01,
            avgPaceSecPer500 = b.u16(9) * 0.01,
        )
    }

    /** 0x0033 Additional Status 2 (>=12 bytes) */
    fun parseAdditionalStatus2(b: ByteArray): AdditionalStatus2 {
        require(b.size >= 12) { "Additional Status 2 needs >=12 bytes, got ${b.size}" }
        return AdditionalStatus2(
            elapsedTimeMs = b.u24(0) * 10L,
            intervalCount = b.u8(3),
            avgPowerW = b.u16(4),
            totalCalories = b.u16(6),
            splitAvgPaceSecPer500 = b.u16(8) * 0.01,
            splitAvgPowerW = b.u16(10),
        )
    }

    /** 0x0035 Stroke Data (>=20 bytes) */
    fun parseStrokeData(b: ByteArray): StrokeData {
        require(b.size >= 20) { "Stroke Data needs >=20 bytes, got ${b.size}" }
        return StrokeData(
            elapsedTimeMs = b.u24(0) * 10L,
            distanceM = b.u24(3) * 0.1,
            driveLengthM = b.u8(6) * 0.01,
            driveTimeMs = b.u8(7) * 10L,
            recoveryTimeMs = b.u16(8) * 10L,
            strokeDistanceM = b.u16(10) * 0.01,
            peakDriveForceLbs = b.u16(12) * 0.1,
            avgDriveForceLbs = b.u16(14) * 0.1,
            workPerStrokeJ = b.u16(16) * 0.1,
            strokeCount = b.u16(18),
        )
    }

    /** 0x0036 Additional Stroke Data (>=15 bytes) */
    fun parseAdditionalStrokeData(b: ByteArray): AdditionalStrokeData {
        require(b.size >= 15) { "Additional Stroke Data needs >=15 bytes, got ${b.size}" }
        return AdditionalStrokeData(
            elapsedTimeMs = b.u24(0) * 10L,
            strokePowerW = b.u16(3),
            strokeCaloriesPerHr = b.u16(5),
            strokeCount = b.u16(7),
            projectedWorkTimeMs = b.u24(9) * 1000L,
            projectedWorkDistanceM = b.u24(12),
        )
    }

    /** 0x0037 Split/Interval Data (>=18 bytes) */
    fun parseSplitIntervalData(b: ByteArray): SplitIntervalData {
        require(b.size >= 18) { "Split/Interval Data needs >=18 bytes, got ${b.size}" }
        return SplitIntervalData(
            elapsedTimeMs = b.u24(0) * 10L,
            distanceM = b.u24(3) * 0.1,
            splitTimeMs = b.u24(6) * 10L,
            splitDistanceM = b.u24(9),
            restTimeMs = b.u16(12) * 10L,
            restDistanceM = b.u16(14),
            type = b.u8(16),
            intervalNumber = b.u8(17),
        )
    }

    /** 0x0038 Additional Split/Interval Data (>=18 bytes) */
    fun parseAdditionalSplitIntervalData(b: ByteArray): AdditionalSplitIntervalData {
        require(b.size >= 18) { "Additional Split/Interval Data needs >=18 bytes, got ${b.size}" }
        val workHr = b.u8(4)
        val restHr = b.u8(5)
        return AdditionalSplitIntervalData(
            elapsedTimeMs = b.u24(0) * 10L,
            strokeRate = b.u8(3),
            workHeartRate = if (workHr == 255) null else workHr,
            restHeartRate = if (restHr == 255) null else restHr,
            avgPaceSecPer500 = b.u16(6) * 0.01,
            totalCalories = b.u16(8),
            avgCaloriesPerHr = b.u16(10),
            speedMps = b.u16(12) * 0.001,
            powerW = b.u16(14),
            avgDragFactor = b.u8(16),
            intervalNumber = b.u8(17),
        )
    }

    /**
     * 0x003C Force Curve — 한 스트로크의 힘 프로파일을 여러 패킷에 나눠 보낸다.
     *
     * 헤더 1바이트: 상위 4비트 = 이 스트로크의 전체 데이터 워드 수,
     * 하위 4비트 = 이 패킷이 싣고 있는 워드 수. 이어서 16비트 LE 값들(파운드)이 온다.
     * 워드 수가 채워지면 한 스트로크가 완성된다.
     *
     * ⚠️ 이 레이아웃은 공식 PDF 로 아직 교차검증하지 못했다(문서 접근 차단).
     * 실기기 로그로 확인하기 전까지 [ForceCurveAssembler.assembled] 결과는
     * 참고용으로만 쓸 것 — 값이 이상하면 헤더 해석부터 의심해야 한다.
     */
    fun parseForceCurveChunk(b: ByteArray): Pair<Int, List<Double>> {
        require(b.isNotEmpty()) { "Force Curve needs >=1 byte" }
        val totalWords = (b.u8(0) shr 4) and 0x0F
        val chunkWords = b.u8(0) and 0x0F
        val values = ArrayList<Double>(chunkWords)
        var i = 1
        var n = 0
        while (n < chunkWords && i + 1 < b.size) {
            values.add(b.u16(i) * 0.1) // 0.1 lbs
            i += 2
            n++
        }
        return totalWords to values
    }

    /** 여러 패킷을 한 스트로크 곡선으로 모은다. */
    class ForceCurveAssembler {
        private val buf = ArrayList<Double>()
        private var expected = 0

        /** 완성된 곡선이면 반환하고 버퍼를 비운다. 아직이면 null. */
        fun onChunk(bytes: ByteArray): List<Double>? {
            val (total, values) = parseForceCurveChunk(bytes)
            if (total > 0) expected = total
            buf.addAll(values)
            if (expected in 1..buf.size) {
                val out = ArrayList(buf.take(expected))
                buf.clear()
                expected = 0
                return out
            }
            return null
        }

        fun clear() {
            buf.clear()
            expected = 0
        }
    }

    /**
     * Concept2 공식 파워↔페이스 관계: watts = 2.80 / (초당미터)^3.
     * 페이스(초/500m)로부터 순간 파워(W)를 산출 — status 특성은 평균 파워만 주므로
     * 페이스 기반 순간값이 훈련 분석에 더 유용하다. pace<=0이면 0.
     */
    fun wattsFromPaceSecPer500(paceSecPer500: Double): Int {
        if (paceSecPer500 <= 0.0) return 0
        val secPerMeter = paceSecPer500 / 500.0
        return (2.80 / (secPerMeter * secPerMeter * secPerMeter)).toInt()
    }
}
