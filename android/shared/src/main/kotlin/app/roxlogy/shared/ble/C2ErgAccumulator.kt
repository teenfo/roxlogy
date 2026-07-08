package app.roxlogy.shared.ble

import app.roxlogy.shared.ingest.ErgSample

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

    fun clear() = bySecond.clear()
}
