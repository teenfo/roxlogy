package app.roxlogy.shared.record

import app.roxlogy.shared.ingest.ErgBlock
import app.roxlogy.shared.ingest.ErgSample
import app.roxlogy.shared.ingest.IngestRequest
import app.roxlogy.shared.ingest.SegmentPayload
import app.roxlogy.shared.ingest.SessionPayload
import app.roxlogy.shared.model.MachineType
import app.roxlogy.shared.model.Stations

/** 워치에서 기록한 한 세그먼트(측정 완료분). */
data class RecordedSegment(
    val kind: String,                    // "run" | "station" | "roxzone"
    val splitTimeMs: Long,
    val exerciseId: String? = null,
    val machineType: String? = null,     // "ski" | "row" | null
    val id: String? = null,              // 클라이언트 생성 세그먼트 id (선택)
    val ergSamples: List<ErgSample> = emptyList(),
    val avgHr: Int? = null,              // 세그먼트 평균/최대 심박 bpm (선택)
    val maxHr: Int? = null,
)

/** 레이스 시뮬 24슬롯의 한 칸(런/록스존/스테이션). UI가 이 뼈대를 채운다. */
data class SegmentSlot(
    val kind: String,
    val exerciseId: String?,
    val machineType: String?,
    val stationKey: String?,
    val index: Int,                      // 1..8
)

/**
 * 기록된 세그먼트 → `ingest-session` 요청 조립 (순수 로직, 하드웨어 불필요).
 * seq는 1부터 연속 부여, total_time_ms는 스플릿 합, erg는 머신 세그먼트에만 첨부.
 */
object SessionAssembler {

    fun assemble(
        sessionId: String,
        startedAtIso: String,
        clientUpdatedAtIso: String,
        segments: List<RecordedSegment>,
        sourceDevice: String = "watch",
        endedAtIso: String? = null,
        templateId: String? = null,
    ): IngestRequest {
        val payloads = segments.mapIndexed { i, s ->
            val erg = if (s.ergSamples.isNotEmpty() && s.machineType != null) {
                ErgBlock(machine_type = s.machineType, samples = rebase(s.ergSamples))
            } else null
            SegmentPayload(
                seq = i + 1,
                kind = s.kind,
                id = s.id,
                exercise_id = s.exerciseId,
                machine_type = s.machineType,
                split_time_ms = s.splitTimeMs,
                erg = erg,
                avg_hr = s.avgHr,
                max_hr = s.maxHr,
            )
        }
        val total = segments.sumOf { it.splitTimeMs }
        return IngestRequest(
            session = SessionPayload(
                id = sessionId,
                started_at = startedAtIso,
                client_updated_at = clientUpdatedAtIso,
                ended_at = endedAtIso,
                total_time_ms = total,
                source_device = sourceDevice,
                template_id = templateId,
            ),
            segments = payloads,
        )
    }

    /** 레이스 시뮬 골격: (런 → 록스존IN → 스테이션 → 록스존OUT) × 8 = 32슬롯.
     *  실제 하이록스처럼 스테이션 진입·이탈 이동을 모두 록스존으로 계측한다.
     *  kind 는 둘 다 "roxzone"(서버 스키마·웹 분석 호환), index 는 라운드 번호 공유. */
    fun raceSimSlots(): List<SegmentSlot> = Stations.ALL.flatMapIndexed { i, station ->
        val n = i + 1
        listOf(
            SegmentSlot("run", Stations.RUN_EXERCISE_ID, null, null, n),
            SegmentSlot("roxzone", null, null, null, n), // IN — 런 → 스테이션 이동
            SegmentSlot(
                kind = "station",
                exerciseId = station.exerciseId,
                machineType = station.machine?.wire,
                stationKey = station.key,
                index = n,
            ),
            SegmentSlot("roxzone", null, null, null, n), // OUT — 스테이션 → 런/피니시 이동
        )
    }

    /** erg raw를 붙일 수 있는 머신 스테이션인지. */
    fun isMachine(machineType: String?): Boolean =
        machineType == MachineType.SKI.wire || machineType == MachineType.ROW.wire

    /**
     * PM5 샘플을 세그먼트 상대값으로 재베이스 — 계약: t=세그먼트 시작 후 경과 초.
     * PM5 status의 t/dist/cal은 머신 자체 타이머·누적치라, 머신이 미리 돌고 있었다면
     * 0이 아닌 값부터 시작한다. 첫 샘플 기준으로 t·dist·cal을 0 기점으로 이동한다.
     * (pace/spm/watts는 순간값이라 그대로 둔다)
     */
    fun rebase(samples: List<ErgSample>): List<ErgSample> {
        val first = samples.firstOrNull() ?: return samples
        if (first.t == 0 && first.dist == 0.0 && (first.cal ?: 0.0) == 0.0) return samples
        return samples.map { s ->
            s.copy(
                t = s.t - first.t,
                dist = s.dist - first.dist,
                cal = if (s.cal != null && first.cal != null) s.cal - first.cal else s.cal,
            )
        }
    }
}
