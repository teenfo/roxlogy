package app.roxlogy.shared.ingest

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * S2 세션 수신 API(`ingest-session`) 요청/응답 모델.
 * 필드명은 서버 계약(docs/API_CONTRACT.md)의 JSON 키와 1:1로 맞춘 snake_case.
 * 워치/폰 공통 — client UUID id, seq, client_updated_at(LWW), soft delete 규칙.
 */

@Serializable
data class ErgSample(
    val t: Int,               // 세그먼트 시작 후 경과 초 (1Hz)
    val dist: Double,         // 누적 거리 m
    val pace: Double? = null, // /500m 초
    val spm: Int? = null,     // 분당 스트로크
    val watts: Int? = null,
    val cal: Double? = null,
)

@Serializable
data class ErgBlock(
    val machine_type: String, // "ski" | "row"
    val samples: List<ErgSample>,
)

@Serializable
data class SegmentPayload(
    val seq: Int,                       // 1부터 연속
    val kind: String,                   // "run" | "station" | "roxzone"
    val id: String? = null,             // 클라이언트 생성 권장
    val exercise_id: String? = null,    // 시드 고정 UUID (Exercises)
    val machine_type: String? = null,   // "ski" | "row" | null
    val split_time_ms: Long? = null,
    val started_at: String? = null,     // ISO8601
    val ended_at: String? = null,
    val erg: ErgBlock? = null,          // PM5 raw (세그먼트당 한 덩어리)
)

@Serializable
data class SessionPayload(
    val id: String,                     // 클라이언트(워치) 생성 UUID
    val started_at: String,             // ISO8601
    val client_updated_at: String,      // ISO8601 — LWW 판정 기준
    val ended_at: String? = null,
    val total_time_ms: Long? = null,
    val source_device: String = "watch",
    val deleted_at: String? = null,     // tombstone
    val template_id: String? = null,
)

/** segments 생략 = 세그먼트 미변경 / 빈 배열 = 전부 삭제 / 배열 = 전체 스냅샷 */
@Serializable
data class IngestRequest(
    val session: SessionPayload,
    val segments: List<SegmentPayload>? = null,
)

@Serializable
data class IngestResponse(
    val applied: Boolean,
    val session_id: String? = null,
    val segments_upserted: Int? = null,
    val samples_upserted: Int? = null,
    val reason: String? = null,         // "stale" 등
)

/** 계약 페이로드 상한 (docs/API_CONTRACT.md). */
object IngestLimits {
    const val MAX_BODY_BYTES = 2 * 1024 * 1024
    const val MAX_SEGMENTS = 64
    const val MAX_SAMPLES_PER_SESSION = 30_000
}

object IngestJson {
    val encoder: Json = Json {
        encodeDefaults = false
        explicitNulls = false
        ignoreUnknownKeys = true
    }

    fun encode(request: IngestRequest): String =
        encoder.encodeToString(IngestRequest.serializer(), request)

    fun decodeResponse(body: String): IngestResponse =
        encoder.decodeFromString(IngestResponse.serializer(), body)
}
