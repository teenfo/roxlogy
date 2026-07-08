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
}
