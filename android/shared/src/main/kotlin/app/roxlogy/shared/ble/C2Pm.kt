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

    // Rowing 서비스 및 특성 UUID (구독 대상)
    val ROWING_SERVICE: String = uuid("0030")
    val GENERAL_STATUS: String = uuid("0031")
    val ADDITIONAL_STATUS_1: String = uuid("0032")
    val ADDITIONAL_STATUS_2: String = uuid("0033")
    val STROKE_DATA: String = uuid("0035")

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
            avgDriveForceLbs = b.u16(14) * 0.1,
            workPerStrokeJ = b.u16(16) * 0.1,
            strokeCount = b.u16(18),
        )
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
