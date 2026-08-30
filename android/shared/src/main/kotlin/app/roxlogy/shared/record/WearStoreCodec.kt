package app.roxlogy.shared.record

import app.roxlogy.shared.sync.LocalSessionMeta
import app.roxlogy.shared.sync.RetentionPolicy
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/**
 * 워치 로컬 영속화 모델·코덱 (순수 로직 — 워치는 SharedPreferences 문자열로 저장).
 *  - SimSnapshot: 진행 중 시뮬 스냅샷 (크래시/이탈 복구). erg 샘플은 용량 문제로
 *    미보존 — 복구 시 스플릿은 유지되고 해당 스테이션의 erg raw만 유실된다.
 *  - StoredSession: 완결 세션 보관함 (재전송용). 보관 정책은 docs/API_CONTRACT.md
 *    (최근 20세션 또는 72시간)를 따른다.
 */
@Serializable
data class SnapSeg(
    val kind: String,
    val splitTimeMs: Long,
    val exerciseId: String? = null,
    val machineType: String? = null,
    val avgHr: Int? = null,
    val maxHr: Int? = null,
)

@Serializable
data class SimSnapshot(
    val startIso: String,
    val slotStartEpochMs: Long, // 현재 슬롯 시작 벽시계 ms — 복구 후 경과가 이어짐
    val segments: List<SnapSeg>,
)

@Serializable
data class StoredSession(
    val id: String,
    val createdAtMs: Long,
    val totalMs: Long,
    val clientUpdatedAt: String,
    val payloadJson: String, // IngestRequest 인코딩 원문 — 재전송 시 그대로 사용
    val sent: Boolean = false,
)

object WearStoreCodec {
    private val json = Json { ignoreUnknownKeys = true }

    const val MAX_SESSIONS = 20
    const val MAX_AGE_MS = 72L * 3600_000L

    fun encodeSnapshot(s: SimSnapshot): String = json.encodeToString(SimSnapshot.serializer(), s)
    fun decodeSnapshot(raw: String): SimSnapshot? =
        try { json.decodeFromString(SimSnapshot.serializer(), raw) } catch (_: Exception) { null }

    fun encodeSessions(list: List<StoredSession>): String =
        json.encodeToString(ListSerializer(StoredSession.serializer()), list)
    fun decodeSessions(raw: String): List<StoredSession> =
        try { json.decodeFromString(ListSerializer(StoredSession.serializer()), raw) } catch (_: Exception) { emptyList() }

    fun toRecorded(s: SimSnapshot): List<RecordedSegment> = s.segments.map {
        RecordedSegment(
            kind = it.kind, splitTimeMs = it.splitTimeMs,
            exerciseId = it.exerciseId, machineType = it.machineType,
            avgHr = it.avgHr, maxHr = it.maxHr,
        )
    }

    fun fromRecorded(segments: List<RecordedSegment>): List<SnapSeg> = segments.map {
        SnapSeg(it.kind, it.splitTimeMs, it.exerciseId, it.machineType, it.avgHr, it.maxHr)
    }

    /**
     * 보관 정책 적용 — 판정은 계약 구현체 RetentionPolicy 하나로 통일한다.
     * 최신순 20개·72시간이 한도지만 **아직 폰에 전달되지 않은(sent=false)
     * 세션은 삭제하지 않는다**(docs/API_CONTRACT.md). 오프라인이거나 전송이
     * 실패했을 뿐이므로 지우면 그대로 유실된다.
     */
    fun prune(list: List<StoredSession>, nowMs: Long): List<StoredSession> {
        val doomed = RetentionPolicy.toPrune(
            list.map { LocalSessionMeta(it.id, it.createdAtMs, it.sent) },
            nowMs,
            MAX_SESSIONS,
            MAX_AGE_MS,
        ).toSet()
        return list.filterNot { it.id in doomed }.sortedByDescending { it.createdAtMs }
    }
}
