package app.roxlogy.shared.sim

import app.roxlogy.shared.ingest.ErgSample
import app.roxlogy.shared.record.RecordedSegment
import app.roxlogy.shared.record.SegmentSlot
import app.roxlogy.shared.record.SessionAssembler

/**
 * 워치 하이록스 시뮬레이션 코어 (순수 로직 — 하드웨어/플랫폼 불필요).
 * 메인 기능: 러닝 8×1km + 스테이션 8개의 스플릿·트랜지션(록스존)을 24슬롯으로 진행 기록.
 * 웹 goal_plans를 불러와 현재 누적 스플릿 vs 목표 diff(앞섬 −/뒤처짐 +)를 계산한다.
 * Wear OS(Kotlin 직접 사용) / 가민(Monkey C 동일 로직 이식) 공통 기준.
 */

/** 웹 goal_plans에서 가져온 목표 스플릿 (모두 ms). */
data class GoalPlan(
    val targetTotalMs: Long,
    val runTotalMs: Long,
    val stationTotalMs: Long,
    val roxzoneTotalMs: Long,
    val stationTargets: Map<String, Long> = emptyMap(), // stationKey -> 목표 ms
)

object HyroxSim {
    const val RUN_METERS = 1000.0
    const val ROUNDS = 8

    /** (런 → 록스존 → 스테이션) × 8 = 24슬롯. */
    fun slots(): List<SegmentSlot> = SessionAssembler.raceSimSlots()

    /** 트레드밀 러닝 진행(0..1): 현재 런 세그먼트의 누적 거리 / 1km. */
    fun runProgress(runDistanceM: Double): Double =
        (runDistanceM / RUN_METERS).coerceIn(0.0, 1.0)

    /** 각 슬롯의 목표 스플릿(ms). run/roxzone는 총합/8 균등, station은 키별 목표(없으면 총합/8). */
    fun perSlotTargetMs(slots: List<SegmentSlot>, goal: GoalPlan): List<Long> {
        val runEach = goal.runTotalMs / ROUNDS
        val roxEach = goal.roxzoneTotalMs / ROUNDS
        val stEach = goal.stationTotalMs / ROUNDS
        return slots.map { s ->
            when (s.kind) {
                "run" -> runEach
                "roxzone" -> roxEach
                "station" -> s.stationKey?.let { goal.stationTargets[it] } ?: stEach
                else -> 0L
            }
        }
    }

    /** 슬롯별 목표의 누적합(각 슬롯 완료 시점의 기대 총시간). */
    fun cumulativeTargetMs(perSlot: List<Long>): List<Long> {
        var acc = 0L
        return perSlot.map { acc += it; acc }
    }

    /** 완료한 스테이션 수(바깥 8세그먼트 점등 개수). */
    fun stationDoneCount(recorded: List<RecordedSegment>): Int =
        recorded.count { it.kind == "station" }

    /**
     * 마지막 체크포인트(완료 슬롯들) 기준 목표 대비 diff(ms).
     * 음수 = 목표보다 빠름(앞섬), 양수 = 느림(뒤처짐). 목표/기록 없으면 null.
     * recorded는 슬롯 순서대로 채워졌다고 가정(SimEngine이 보장).
     */
    fun checkpointDiffMs(
        recorded: List<RecordedSegment>,
        goal: GoalPlan?,
        slots: List<SegmentSlot> = slots(),
    ): Long? {
        if (goal == null || recorded.isEmpty()) return null
        val perSlot = perSlotTargetMs(slots, goal)
        val n = recorded.size.coerceAtMost(perSlot.size)
        val targetSoFar = perSlot.take(n).sum()
        val actualSoFar = recorded.take(n).sumOf { it.splitTimeMs }
        return actualSoFar - targetSoFar
    }

    /** 진행 중인 슬롯의 목표 스플릿(ms). 라이브 diff(현재 경과 − 목표)에 사용. 없으면 null. */
    fun slotTargetMs(slotIndex: Int, goal: GoalPlan?, slots: List<SegmentSlot> = slots()): Long? {
        if (goal == null) return null
        return perSlotTargetMs(slots, goal).getOrNull(slotIndex)
    }
}

/**
 * 시뮬 진행 상태기계 (UI 편의용, 순수). 슬롯 순서대로 record() 하면 index가 전진한다.
 * 스테이션 시작/종료는 1차 버튼 기반 — UI가 경과 ms를 측정해 record()로 넘긴다.
 */
class SimEngine(
    val slots: List<SegmentSlot> = HyroxSim.slots(),
) {
    private val recorded = mutableListOf<RecordedSegment>()
    var index: Int = 0
        private set

    val current: SegmentSlot? get() = slots.getOrNull(index)
    val isDone: Boolean get() = index >= slots.size

    /** 완료 스테이션 수 = 바깥 링 점등 개수. */
    fun stationDoneCount(): Int = HyroxSim.stationDoneCount(recorded)

    /** 현재 슬롯이 스테이션이면 그 서수(0..7), 아니면 -1 — 바깥 링 활성 세그먼트. */
    fun activeStationOrdinal(): Int {
        val c = current ?: return -1
        return if (c.kind == "station") c.index - 1 else -1
    }

    /** 현재 슬롯(런) 진행 표시용 — 거리(m) → 0..1. 런이 아니면 0. */
    fun runProgress(runDistanceM: Double): Double =
        if (current?.kind == "run") HyroxSim.runProgress(runDistanceM) else 0.0

    /** 현재 슬롯 기록 후 다음으로 전진. 스테이션 슬롯에만 erg raw를 첨부한다. */
    fun record(splitMs: Long, ergSamples: List<ErgSample> = emptyList()) {
        val c = current ?: return
        recorded.add(
            RecordedSegment(
                kind = c.kind,
                splitTimeMs = splitMs,
                exerciseId = c.exerciseId,
                machineType = c.machineType,
                ergSamples = if (c.kind == "station") ergSamples else emptyList(),
            ),
        )
        index++
    }

    fun recordedSegments(): List<RecordedSegment> = recorded.toList()

    fun elapsedTotalMs(): Long = recorded.sumOf { it.splitTimeMs }

    /** 지금까지 목표 대비 diff(ms) — 음수 앞섬 / 양수 뒤처짐. */
    fun checkpointDiffMs(goal: GoalPlan?): Long? =
        HyroxSim.checkpointDiffMs(recorded, goal, slots)
}
