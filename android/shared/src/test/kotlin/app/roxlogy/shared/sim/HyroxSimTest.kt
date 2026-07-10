package app.roxlogy.shared.sim

import app.roxlogy.shared.ingest.ErgSample
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class HyroxSimTest {

    // 러닝 4:30/km(270s), 록스존 8s, 스테이션은 키별 목표. 총합은 검증에 쓰지 않는 근사값.
    private val goal = GoalPlan(
        targetTotalMs = 3_600_000,
        runTotalMs = 270_000L * 8,
        stationTotalMs = 240_000L * 8,
        roxzoneTotalMs = 8_000L * 8,
        stationTargets = mapOf(
            "ski" to 260_000, "sledpush" to 150_000, "sledpull" to 170_000,
            "burpee" to 300_000, "row" to 250_000, "farmers" to 120_000,
            "lunges" to 240_000, "wallballs" to 320_000,
        ),
    )

    @Test
    fun `run progress clamps 0 to 1`() {
        assertEquals(0.0, HyroxSim.runProgress(0.0))
        assertEquals(0.5, HyroxSim.runProgress(500.0))
        assertEquals(1.0, HyroxSim.runProgress(1000.0))
        assertEquals(1.0, HyroxSim.runProgress(1300.0)) // 넘어가도 1
    }

    @Test
    fun `per slot targets map by kind and station key`() {
        val slots = HyroxSim.slots()
        val per = HyroxSim.perSlotTargetMs(slots, goal)
        assertEquals(24, per.size)
        assertEquals(270_000L, per[0])   // run
        assertEquals(8_000L, per[1])     // roxzone
        assertEquals(260_000L, per[2])   // station ski
        assertEquals(320_000L, per[23])  // station wallballs
        // 누적은 단조 증가
        val cum = HyroxSim.cumulativeTargetMs(per)
        assertTrue(cum.zipWithNext().all { (a, b) -> b >= a })
        assertEquals(per.sum(), cum.last())
    }

    @Test
    fun `station key missing falls back to station average`() {
        val g = goal.copy(stationTargets = emptyMap())
        val per = HyroxSim.perSlotTargetMs(HyroxSim.slots(), g)
        assertEquals(240_000L, per[2]) // stationTotal/8
    }

    @Test
    fun `engine advances in slot order and counts stations`() {
        val e = SimEngine()
        assertEquals("run", e.current?.kind)
        assertEquals(0, e.stationDoneCount())
        // 첫 라운드: run, roxzone, station(ski)
        e.record(268_000)                // run
        assertEquals("roxzone", e.current?.kind)
        e.record(9_000)                  // roxzone
        assertEquals("station", e.current?.kind)
        assertEquals(0, e.activeStationOrdinal()) // ski = 0
        e.record(255_000, listOf(ErgSample(t = 0, dist = 0.0, watts = 210))) // station
        assertEquals(1, e.stationDoneCount())
        assertEquals(268_000 + 9_000 + 255_000L, e.elapsedTotalMs())
        // erg는 스테이션에만 첨부
        val segs = e.recordedSegments()
        assertTrue(segs[0].ergSamples.isEmpty())
        assertEquals(1, segs[2].ergSamples.size)
    }

    @Test
    fun `checkpoint diff is negative when ahead of goal`() {
        val e = SimEngine()
        e.record(260_000) // run: 목표 270_000 → 10s 앞섬
        val diff = e.checkpointDiffMs(goal)
        assertEquals(-10_000L, diff)
    }

    @Test
    fun `checkpoint diff is positive when behind goal`() {
        val e = SimEngine()
        e.record(275_000) // run: 목표 270_000 → 5s 뒤처짐
        e.record(20_000)  // roxzone: 목표 8_000 → 12s 뒤처짐 누적
        assertEquals(5_000L + 12_000L, e.checkpointDiffMs(goal))
    }

    @Test
    fun `diff is null without goal or without records`() {
        val e = SimEngine()
        assertNull(e.checkpointDiffMs(goal)) // 아직 기록 없음
        e.record(270_000)
        assertNull(e.checkpointDiffMs(null)) // 목표 없음
    }

    @Test
    fun `full sim completes 24 slots with 8 stations`() {
        val e = SimEngine()
        var guard = 0
        while (!e.isDone && guard++ < 100) e.record(100_000)
        assertTrue(e.isDone)
        assertEquals(8, e.stationDoneCount())
        assertEquals(24, e.recordedSegments().size)
        assertEquals(-1, e.activeStationOrdinal()) // 완료 후 활성 없음
    }
}
