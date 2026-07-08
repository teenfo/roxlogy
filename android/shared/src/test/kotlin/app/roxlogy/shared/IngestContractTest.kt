package app.roxlogy.shared

import app.roxlogy.shared.ingest.ErgBlock
import app.roxlogy.shared.ingest.ErgSample
import app.roxlogy.shared.ingest.IngestJson
import app.roxlogy.shared.ingest.IngestRequest
import app.roxlogy.shared.ingest.IngestResponse
import app.roxlogy.shared.ingest.SegmentPayload
import app.roxlogy.shared.ingest.SessionPayload
import app.roxlogy.shared.model.Stations
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class IngestContractTest {

    private fun sampleRequest() = IngestRequest(
        session = SessionPayload(
            id = "11111111-1111-1111-1111-111111111111",
            started_at = "2026-07-08T10:00:00Z",
            client_updated_at = "2026-07-08T10:40:00Z",
            ended_at = "2026-07-08T10:39:37Z",
            total_time_ms = 3937000,
            source_device = "watch",
        ),
        segments = listOf(
            SegmentPayload(
                seq = 1,
                kind = "station",
                id = "22222222-2222-2222-2222-222222222222",
                exercise_id = Stations.byKey("ski")!!.exerciseId,
                machine_type = "ski",
                split_time_ms = 267000,
                erg = ErgBlock(
                    machine_type = "ski",
                    samples = listOf(
                        ErgSample(t = 0, dist = 0.0, pace = 120.5, spm = 32, watts = 210, cal = 0.0),
                        ErgSample(t = 1, dist = 4.2, pace = 118.0, spm = 33, watts = 214, cal = 0.2),
                    ),
                ),
            ),
        ),
    )

    @Test
    fun `encodes to the contract json keys`() {
        val json = IngestJson.encode(sampleRequest())
        // 서버 계약 키가 그대로 나와야 한다 (snake_case, user_id 미포함)
        assertTrue(json.contains("\"client_updated_at\""))
        assertTrue(json.contains("\"source_device\":\"watch\""))
        assertTrue(json.contains("\"split_time_ms\":267000"))
        assertTrue(json.contains("\"machine_type\":\"ski\""))
        assertFalse(json.contains("user_id"), "user_id는 서버가 토큰에서 결정 — 보내지 않는다")
    }

    @Test
    fun `omits nulls and defaults so payload stays lean`() {
        val json = IngestJson.encode(sampleRequest())
        // deleted_at=null, template_id=null 등은 직렬화에서 생략
        assertFalse(json.contains("deleted_at"))
        assertFalse(json.contains("template_id"))
    }

    @Test
    fun `decodes both applied and stale responses`() {
        val ok: IngestResponse = IngestJson.decodeResponse(
            """{"applied":true,"session_id":"s","segments_upserted":24,"samples_upserted":480}""",
        )
        assertTrue(ok.applied)
        assertEquals(24, ok.segments_upserted)

        val stale = IngestJson.decodeResponse("""{"applied":false,"session_id":"s","reason":"stale"}""")
        assertFalse(stale.applied)
        assertEquals("stale", stale.reason)
    }

    @Test
    fun `station exercise ids match the web seed`() {
        assertEquals(8, Stations.ALL.size)
        assertEquals("e0000000-0000-0000-0000-000000000001", Stations.byKey("ski")!!.exerciseId)
        assertEquals("e0000000-0000-0000-0000-000000000008", Stations.byKey("wallballs")!!.exerciseId)
        assertEquals("e0000000-0000-0000-0000-000000000009", Stations.RUN_EXERCISE_ID)
    }
}
