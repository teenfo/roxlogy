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
