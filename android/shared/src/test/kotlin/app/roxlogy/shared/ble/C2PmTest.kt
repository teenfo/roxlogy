package app.roxlogy.shared.ble

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * PM5 프레임 파싱 검증 — 알려진 바이트(리틀엔디언) → 기대 물리값.
 * 파싱 메커니즘(엔디언·스케일·오프셋)을 하드웨어 없이 확정한다.
 */
class C2PmTest {

    private fun bytes(vararg v: Int): ByteArray = ByteArray(v.size) { v[it].toByte() }

    @Test
    fun `general status decodes time distance and states`() {
        // elapsed u24=1000(*0.01s=10s), dist u24=2500(*0.1m=250m), drag=120
        val b = bytes(
            0xE8, 0x03, 0x00,   // elapsed 1000
            0xC4, 0x09, 0x00,   // distance 2500
            0x00, 0x00,         // workout/interval type
            0x01,               // workout state
            0x01,               // rowing state
            0x02,               // stroke state
            0, 0, 0, 0, 0, 0, 0, // total work dist / duration
            120,                // drag factor
        )
        val gs = C2Pm.parseGeneralStatus(b)
        assertEquals(10_000L, gs.elapsedTimeMs)
        assertEquals(250.0, gs.distanceM, 1e-9)
        assertEquals(1, gs.workoutState)
        assertEquals(2, gs.strokeState)
        assertEquals(120, gs.dragFactor)
    }

    @Test
    fun `additional status 1 decodes spm pace and heart rate`() {
        val b = bytes(
            0xE8, 0x03, 0x00,   // elapsed 1000
            0xA0, 0x0F,         // speed 4000 (*0.001 = 4.0 m/s)
            30,                 // stroke rate
            150,                // heart rate
            0xE0, 0x2E,         // current pace 12000 (*0.01 = 120.0 s/500m)
            0xD4, 0x30,         // avg pace 12500 (125.0)
        )
        val a1 = C2Pm.parseAdditionalStatus1(b)
        assertEquals(10_000L, a1.elapsedTimeMs)
        assertEquals(4.0, a1.speedMps, 1e-9)
        assertEquals(30, a1.strokeRate)
        assertEquals(150, a1.heartRate)
        assertEquals(120.0, a1.currentPaceSecPer500, 1e-9)
        assertEquals(125.0, a1.avgPaceSecPer500, 1e-9)
    }

    @Test
    fun `additional status 1 treats heart rate 255 as invalid`() {
        val b = bytes(0, 0, 0, 0, 0, 20, 255, 0xE0, 0x2E, 0xE0, 0x2E)
        assertNull(C2Pm.parseAdditionalStatus1(b).heartRate)
    }

    @Test
    fun `additional status 2 decodes power and calories`() {
        val b = bytes(
            0xE8, 0x03, 0x00,   // elapsed 1000
            1,                  // interval count
            0xCD, 0x00,         // avg power 205 W
            0x58, 0x00,         // total calories 88
            0x18, 0x2E,         // split avg pace 11800 (118.0)
            0xD2, 0x00,         // split avg power 210 W
        )
        val a2 = C2Pm.parseAdditionalStatus2(b)
        assertEquals(205, a2.avgPowerW)
        assertEquals(88, a2.totalCalories)
        assertEquals(118.0, a2.splitAvgPaceSecPer500, 1e-9)
        assertEquals(210, a2.splitAvgPowerW)
    }

    @Test
    fun `stroke data decodes count and forces`() {
        val b = bytes(
            0xE8, 0x03, 0x00,   // elapsed 1000
            0xC4, 0x09, 0x00,   // distance 2500
            0, 0, 0, 0, 0, 0, 0, 0, // drive/recovery/stroke dist/peak force
            0x84, 0x03,         // avg drive force 900 (*0.1 = 90.0 lbs)
            0xB8, 0x0B,         // work per stroke 3000 (*0.1 = 300.0 J)
            0x2A, 0x00,         // stroke count 42
        )
        val sd = C2Pm.parseStrokeData(b)
        assertEquals(250.0, sd.distanceM, 1e-9)
        assertEquals(90.0, sd.avgDriveForceLbs, 1e-9)
        assertEquals(300.0, sd.workPerStrokeJ, 1e-9)
        assertEquals(42, sd.strokeCount)
    }

    @Test
    fun `power from pace matches concept2 formula`() {
        // pace 120 s/500m → 0.24 s/m → 2.8/0.24^3 ≈ 202 W
        assertEquals(202, C2Pm.wattsFromPaceSecPer500(120.0))
        assertEquals(0, C2Pm.wattsFromPaceSecPer500(0.0))
        assertEquals(0, C2Pm.wattsFromPaceSecPer500(-5.0))
    }

    @Test
    fun `accumulator merges status streams into per-second samples`() {
        val acc = C2ErgAccumulator()
        // second 10
        acc.onGeneralStatus(C2Pm.GeneralStatus(10_000, 250.0, 1, 1, 2, 120))
        acc.onAdditionalStatus1(C2Pm.AdditionalStatus1(10_000, 4.0, 30, 150, 120.0, 125.0))
        acc.onAdditionalStatus2(C2Pm.AdditionalStatus2(10_000, 1, 205, 88, 118.0, 210))
        // second 11 (only general so far)
        acc.onGeneralStatus(C2Pm.GeneralStatus(11_000, 254.5, 1, 1, 2, 120))

        val out = acc.snapshot()
        assertEquals(2, out.size)
        val s10 = out[0]
        assertEquals(10, s10.t)
        assertEquals(250.0, s10.dist, 1e-9)
        assertEquals(30, s10.spm)
        assertEquals(120.0, s10.pace)
        assertEquals(202, s10.watts) // 페이스 기반 순간 파워 우선
        assertEquals(88.0, s10.cal)
        assertEquals(11, out[1].t)   // 정렬 보장
        assertEquals(254.5, out[1].dist, 1e-9)
    }

    /**
     * 광고에 실리는 서비스는 Discovery(CE060000-…) 하나뿐 — 스캔 필터/매칭 기준.
     * Rowing(CE060030-…)은 연결 후 GATT 에서만 보이므로 스캔에 쓰면 기기가 안 잡힌다.
     * (Concept2 PM Bluetooth Smart Interface Definition)
     */
    @Test
    fun `서비스 UUID가 공식 스펙과 일치`() {
        assertEquals("CE060000-43E5-11E4-916C-0800200C9A66", C2Pm.DISCOVERY_SERVICE)
        assertEquals("CE060010-43E5-11E4-916C-0800200C9A66", C2Pm.INFORMATION_SERVICE)
        assertEquals("CE060020-43E5-11E4-916C-0800200C9A66", C2Pm.CONTROL_SERVICE)
        assertEquals("CE060030-43E5-11E4-916C-0800200C9A66", C2Pm.ROWING_SERVICE)
        assertEquals("CE060031-43E5-11E4-916C-0800200C9A66", C2Pm.GENERAL_STATUS)
        assertEquals("CE060032-43E5-11E4-916C-0800200C9A66", C2Pm.ADDITIONAL_STATUS_1)
        assertEquals("CE060033-43E5-11E4-916C-0800200C9A66", C2Pm.ADDITIONAL_STATUS_2)
        assertEquals("CE060035-43E5-11E4-916C-0800200C9A66", C2Pm.STROKE_DATA)
    }

    // ---- 확장 특성 (0x0035/0x0036/0x0037/0x0038/0x003C) ----
    // 오프셋은 ErgometerJS(공개 구현) 레이아웃과 대조해 확정했다. 0x0035 는 기존
    // 파서와 정확히 일치해 교차검증됐고, 나머지는 같은 순차 패킹 규칙을 따른다.

    private fun le16(n: Int) = listOf(n and 0xFF, (n shr 8) and 0xFF)
    private fun le24(n: Int) = listOf(n and 0xFF, (n shr 8) and 0xFF, (n shr 16) and 0xFF)

    @Test
    fun `0x0035 스트로크 데이터 전 필드 파싱`() {
        val b = (le24(1234) + le24(2500) + listOf(55, 8) + le16(210) + le16(1050) +
            le16(2400) + le16(1800) + le16(3300) + le16(42))
            .let { l -> ByteArray(l.size) { l[it].toByte() } }
        val d = C2Pm.parseStrokeData(b)
        assertEquals(12_340L, d.elapsedTimeMs)     // 1234 × 0.01s
        assertEquals(250.0, d.distanceM, 1e-9)     // 2500 × 0.1m
        assertEquals(0.55, d.driveLengthM, 1e-9)   // 55 × 0.01m
        assertEquals(80L, d.driveTimeMs)           // 8 × 0.01s
        assertEquals(2_100L, d.recoveryTimeMs)     // 210 × 0.01s
        assertEquals(10.5, d.strokeDistanceM, 1e-9)
        assertEquals(240.0, d.peakDriveForceLbs, 1e-9)
        assertEquals(180.0, d.avgDriveForceLbs, 1e-9)
        assertEquals(330.0, d.workPerStrokeJ, 1e-9)
        assertEquals(42, d.strokeCount)
    }

    @Test
    fun `0x0036 추가 스트로크 데이터 파싱`() {
        val b = (le24(1000) + le16(215) + le16(700) + le16(43) + le24(120) + le24(2000))
            .let { l -> ByteArray(l.size) { l[it].toByte() } }
        val d = C2Pm.parseAdditionalStrokeData(b)
        assertEquals(10_000L, d.elapsedTimeMs)
        assertEquals(215, d.strokePowerW)
        assertEquals(700, d.strokeCaloriesPerHr)
        assertEquals(43, d.strokeCount)
        assertEquals(120_000L, d.projectedWorkTimeMs)
        assertEquals(2000, d.projectedWorkDistanceM)
    }

    @Test
    fun `0x0037 스플릿 데이터 파싱`() {
        val b = (le24(5000) + le24(10000) + le24(1200) + le24(500) + le16(300) + le16(0) +
            listOf(1, 3))
            .let { l -> ByteArray(l.size) { l[it].toByte() } }
        val d = C2Pm.parseSplitIntervalData(b)
        assertEquals(50_000L, d.elapsedTimeMs)
        assertEquals(1000.0, d.distanceM, 1e-9)
        assertEquals(12_000L, d.splitTimeMs)
        assertEquals(500, d.splitDistanceM)
        assertEquals(3_000L, d.restTimeMs)
        assertEquals(0, d.restDistanceM)
        assertEquals(1, d.type)
        assertEquals(3, d.intervalNumber)
    }

    @Test
    fun `0x0038 추가 스플릿 데이터 파싱 — 심박 255는 무효`() {
        val b = (le24(5000) + listOf(30, 255, 140) + le16(12000) + le16(88) + le16(600) +
            le16(4000) + le16(210) + listOf(120, 3))
            .let { l -> ByteArray(l.size) { l[it].toByte() } }
        val d = C2Pm.parseAdditionalSplitIntervalData(b)
        assertEquals(30, d.strokeRate)
        assertEquals(null, d.workHeartRate)   // 255 = 무효
        assertEquals(140, d.restHeartRate)
        assertEquals(120.0, d.avgPaceSecPer500, 1e-9)
        assertEquals(88, d.totalCalories)
        assertEquals(600, d.avgCaloriesPerHr)
        assertEquals(4.0, d.speedMps, 1e-9)
        assertEquals(210, d.powerW)
        assertEquals(120, d.avgDragFactor)
        assertEquals(3, d.intervalNumber)
    }

    @Test
    fun `0x003C 힘 곡선은 여러 패킷을 한 스트로크로 조립`() {
        val asm = C2Pm.ForceCurveAssembler()
        // 헤더 0x53 = 전체 5워드 / 이번 3워드
        val first = (listOf(0x53) + le16(100) + le16(250) + le16(400))
            .let { l -> ByteArray(l.size) { l[it].toByte() } }
        assertEquals(null, asm.onChunk(first)) // 아직 미완성
        // 헤더 0x02 = 이번 2워드 (전체는 앞 패킷에서 확정)
        val second = (listOf(0x02) + le16(300) + le16(120))
            .let { l -> ByteArray(l.size) { l[it].toByte() } }
        val curve = asm.onChunk(second)
        assertEquals(listOf(10.0, 25.0, 40.0, 30.0, 12.0), curve)
    }
}
