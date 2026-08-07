package app.roxlogy.shared.ble

import app.roxlogy.shared.ingest.ErgForceCurve
import app.roxlogy.shared.ingest.ErgSample
import app.roxlogy.shared.ingest.ErgSplit
import app.roxlogy.shared.ingest.ErgStroke

/**
 * PM5 status 알림 스트림(General / Additional 1·2)을 **1Hz ErgSample 목록**으로 병합.
 * 각 특성은 자체 주기로 도착하므로 경과시간의 정수 초를 버킷 키로 삼아 누적한다.
 * 원본 1Hz 보존 원칙(API_CONTRACT) — 다운샘플/파생은 워커가 담당, 클라이언트는 원본만.
 *
 * watts는 현재 페이스 기반 순간값(C2 공식)을 우선, 없으면 status의 평균 파워로 폴백.
 */
class C2ErgAccumulator {

    private class Acc(
        var dist: Double? = null,
        var pace: Double? = null,
        var spm: Int? = null,
        var watts: Int? = null,
        var cal: Double? = null,
    )

    // 초(second) → 누적. 정렬 보장 위해 키 정렬.
    private val bySecond = sortedMapOf<Int, Acc>()

    private fun bucket(elapsedMs: Long): Acc {
        val sec = (elapsedMs / 1000L).toInt()
        return bySecond.getOrPut(sec) { Acc() }
    }

    fun onGeneralStatus(gs: C2Pm.GeneralStatus) {
        bucket(gs.elapsedTimeMs).dist = gs.distanceM
    }

    fun onAdditionalStatus1(a1: C2Pm.AdditionalStatus1) {
        val a = bucket(a1.elapsedTimeMs)
        a.spm = a1.strokeRate
        a.pace = a1.currentPaceSecPer500
        if (a1.currentPaceSecPer500 > 0.0) {
            a.watts = C2Pm.wattsFromPaceSecPer500(a1.currentPaceSecPer500)
        }
    }

    fun onAdditionalStatus2(a2: C2Pm.AdditionalStatus2) {
        val a = bucket(a2.elapsedTimeMs)
        a.cal = a2.totalCalories.toDouble()
        if (a.watts == null) a.watts = a2.avgPowerW
    }

    // ---- 스트로크·스플릿·힘곡선 (이벤트성 — 초 버킷과 별도로 순서대로 쌓는다) ----

    private val strokes = ArrayList<ErgStroke>()
    private val splits = ArrayList<ErgSplit>()
    private val forceCurves = ArrayList<ErgForceCurve>()

    /** 0x0035 — 스트로크 하나가 끝날 때마다 도착. 같은 스트로크 번호는 갱신. */
    fun onStroke(s: C2Pm.StrokeData) {
        val e = ErgStroke(
            n = s.strokeCount,
            t = (s.elapsedTimeMs / 1000L).toInt(),
            dist = s.distanceM,
            drive_len = s.driveLengthM,
            drive_ms = s.driveTimeMs,
            recover_ms = s.recoveryTimeMs,
            stroke_dist = s.strokeDistanceM,
            peak_force = s.peakDriveForceLbs,
            avg_force = s.avgDriveForceLbs,
            work_j = s.workPerStrokeJ,
        )
        val idx = strokes.indexOfFirst { it.n == e.n }
        if (idx >= 0) strokes[idx] = strokes[idx].copy(
            t = e.t, dist = e.dist, drive_len = e.drive_len, drive_ms = e.drive_ms,
            recover_ms = e.recover_ms, stroke_dist = e.stroke_dist,
            peak_force = e.peak_force, avg_force = e.avg_force, work_j = e.work_j,
        ) else strokes.add(e)
    }

    /** 0x0036 — 같은 스트로크 번호에 파워·칼로리를 얹는다. */
    fun onAdditionalStroke(a: C2Pm.AdditionalStrokeData) {
        val idx = strokes.indexOfFirst { it.n == a.strokeCount }
        if (idx >= 0) {
            strokes[idx] = strokes[idx].copy(watts = a.strokePowerW, cal_hr = a.strokeCaloriesPerHr)
        } else {
            strokes.add(
                ErgStroke(
                    n = a.strokeCount,
                    t = (a.elapsedTimeMs / 1000L).toInt(),
                    watts = a.strokePowerW,
                    cal_hr = a.strokeCaloriesPerHr,
                ),
            )
        }
    }

    /** 0x0037 — 인터벌/스플릿 종료 시. 같은 번호는 갱신. */
    fun onSplit(s: C2Pm.SplitIntervalData) {
        val e = ErgSplit(
            n = s.intervalNumber,
            type = s.type,
            t = (s.elapsedTimeMs / 1000L).toInt(),
            dist = s.distanceM,
            split_ms = s.splitTimeMs,
            split_dist = s.splitDistanceM,
            rest_ms = s.restTimeMs,
            rest_dist = s.restDistanceM,
        )
        val idx = splits.indexOfFirst { it.n == e.n }
        if (idx >= 0) splits[idx] = splits[idx].copy(
            type = e.type, t = e.t, dist = e.dist, split_ms = e.split_ms,
            split_dist = e.split_dist, rest_ms = e.rest_ms, rest_dist = e.rest_dist,
        ) else splits.add(e)
    }

    /** 0x0038 — 같은 스플릿 번호에 spm·페이스·파워 등을 얹는다. */
    fun onAdditionalSplit(a: C2Pm.AdditionalSplitIntervalData) {
        val idx = splits.indexOfFirst { it.n == a.intervalNumber }
        val patch: (ErgSplit) -> ErgSplit = {
            it.copy(
                spm = a.strokeRate, hr = a.workHeartRate, pace = a.avgPaceSecPer500,
                cal = a.totalCalories, watts = a.powerW, drag = a.avgDragFactor,
            )
        }
        if (idx >= 0) splits[idx] = patch(splits[idx])
        else splits.add(patch(ErgSplit(n = a.intervalNumber, t = (a.elapsedTimeMs / 1000L).toInt())))
    }

    /** 0x003C — 조립이 끝난 스트로크 하나의 힘 곡선(파운드). */
    fun onForceCurve(points: List<Double>) {
        if (points.isEmpty()) return
        forceCurves.add(ErgForceCurve(n = strokes.lastOrNull()?.n ?: forceCurves.size + 1, f = points))
    }

    /** 현재까지 누적된 초별 샘플 (t 오름차순). */
    fun snapshot(): List<ErgSample> = bySecond.entries.map { (sec, a) ->
        ErgSample(
            t = sec,
            dist = a.dist ?: 0.0,
            pace = a.pace,
            spm = a.spm,
            watts = a.watts,
            cal = a.cal,
        )
    }

    fun strokeSnapshot(): List<ErgStroke> = strokes.sortedBy { it.n }
    fun splitSnapshot(): List<ErgSplit> = splits.sortedBy { it.n }
    fun forceCurveSnapshot(): List<ErgForceCurve> = forceCurves.toList()

    fun clear() {
        bySecond.clear()
        strokes.clear()
        splits.clear()
        forceCurves.clear()
    }
}
