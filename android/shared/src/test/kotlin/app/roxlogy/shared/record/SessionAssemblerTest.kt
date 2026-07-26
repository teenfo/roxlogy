package app.roxlogy.shared.record

import app.roxlogy.shared.ingest.ErgSample
import app.roxlogy.shared.model.Stations
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SessionAssemblerTest {

    @Test
    fun `assembles sequential seq total time and erg only on machine segments`() {
        val segs = listOf(
            RecordedSegment("run", 300_000, Stations.RUN_EXERCISE_ID),
            RecordedSegment("roxzone", 8_000),
            RecordedSegment(
                kind = "station",
                splitTimeMs = 267_000,
                exerciseId = Stations.byKey("ski")!!.exerciseId,
                machineType = "ski",
                ergSamples = listOf(ErgSample(t = 0, dist = 0.0, watts = 200)),
            ),
            RecordedSegment(
                kind = "station",
                splitTimeMs = 190_000,
                exerciseId = Stations.byKey("sledpush")!!.exerciseId,
                machineType = null,
                ergSamples = listOf(ErgSample(t = 0, dist = 0.0)), // 머신 아님 → erg 무시
            ),
        )
        val req = SessionAssembler.assemble(
            sessionId = "s1",
            startedAtIso = "2026-07-08T10:00:00Z",
            clientUpdatedAtIso = "2026-07-08T10:20:00Z",
            segments = segs,
        )

        assertEquals("watch", req.session.source_device)
        assertEquals(300_000 + 8_000 + 267_000 + 190_000L, req.session.total_time_ms)
        val payloads = req.segments!!
        assertEquals(listOf(1, 2, 3, 4), payloads.map { it.seq })
        // ski 세그먼트에만 erg 붙음
        assertEquals("ski", payloads[2].erg?.machine_type)
        assertNull(payloads[3].erg) // machineType=null → erg 미첨부
    }

    @Test
    fun `rebases erg samples to segment-relative t dist cal`() {
        // 머신이 워밍업으로 이미 돌던 상태: t=300s, dist=1200m, cal=45부터 시작
        val raw = listOf(
            ErgSample(t = 300, dist = 1200.0, pace = 105.0, spm = 38, watts = 240, cal = 45.0),
            ErgSample(t = 301, dist = 1205.5, pace = 104.0, spm = 39, watts = 245, cal = 45.4),
            ErgSample(t = 302, dist = 1211.0, pace = 103.5, spm = 39, watts = 248, cal = 45.8),
        )
        val out = SessionAssembler.rebase(raw)
        assertEquals(listOf(0, 1, 2), out.map { it.t })
        assertEquals(0.0, out[0].dist)
        assertEquals(5.5, out[1].dist, 0.001)
        assertEquals(0.0, out[0].cal!!, 0.001)
        assertEquals(0.8, out[2].cal!!, 0.001)
        // 순간값은 보존
        assertEquals(105.0, out[0].pace)
        assertEquals(248, out[2].watts)
        // 이미 0 기점이면 그대로
        val zero = listOf(ErgSample(t = 0, dist = 0.0, cal = 0.0))
        assertEquals(zero, SessionAssembler.rebase(zero))
    }

    @Test
    fun `assemble attaches rebased samples`() {
        val segs = listOf(
            RecordedSegment(
                kind = "station",
                splitTimeMs = 200_000,
                exerciseId = Stations.byKey("row")!!.exerciseId,
                machineType = "row",
                ergSamples = listOf(
                    ErgSample(t = 50, dist = 210.0, watts = 200),
                    ErgSample(t = 51, dist = 215.0, watts = 205),
                ),
            ),
        )
        val req = SessionAssembler.assemble(
            sessionId = "s2",
            startedAtIso = "2026-07-26T10:00:00Z",
            clientUpdatedAtIso = "2026-07-26T10:05:00Z",
            segments = segs,
        )
        val samples = req.segments!![0].erg!!.samples
        assertEquals(listOf(0, 1), samples.map { it.t })
        assertEquals(0.0, samples[0].dist)
    }

    @Test
    fun `race sim slots produce 24 in run-roxzone-station order`() {
        val slots = SessionAssembler.raceSimSlots()
        assertEquals(24, slots.size)
        assertEquals("run", slots[0].kind)
        assertEquals("roxzone", slots[1].kind)
        assertEquals("station", slots[2].kind)
        assertEquals("ski", slots[2].stationKey)
        assertEquals("wallballs", slots[23].stationKey)
        assertTrue(slots.count { it.kind == "station" } == 8)
    }
}
