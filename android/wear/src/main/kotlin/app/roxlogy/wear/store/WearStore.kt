package app.roxlogy.wear.store

import android.content.Context
import app.roxlogy.shared.record.SimSnapshot
import app.roxlogy.shared.record.StoredSession
import app.roxlogy.shared.record.WearStoreCodec

/**
 * 워치 로컬 영속화 — SharedPreferences 문자열 저장, 코덱·보관정책은 :shared.
 *  - 진행 중 시뮬 스냅샷: 앱 크래시/이탈 후 "이어서 기록" 복구
 *  - 완결 세션 보관함: 최근 20세션·72시간, 재전송 지원 (docs/API_CONTRACT.md)
 */
object WearStore {
    private const val PREFS = "rox_store"
    private const val KEY_PROGRESS = "progress"
    private const val KEY_SESSIONS = "sessions"
    private const val KEY_HAPTIC = "haptic"

    private fun p(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun saveProgress(c: Context, snap: SimSnapshot) =
        p(c).edit().putString(KEY_PROGRESS, WearStoreCodec.encodeSnapshot(snap)).apply()

    fun loadProgress(c: Context): SimSnapshot? =
        p(c).getString(KEY_PROGRESS, null)?.let(WearStoreCodec::decodeSnapshot)

    fun clearProgress(c: Context) = p(c).edit().remove(KEY_PROGRESS).apply()

    fun sessions(c: Context): List<StoredSession> =
        WearStoreCodec.prune(
            p(c).getString(KEY_SESSIONS, null)?.let(WearStoreCodec::decodeSessions) ?: emptyList(),
            System.currentTimeMillis(),
        )

    fun addSession(c: Context, s: StoredSession) {
        val next = WearStoreCodec.prune(
            sessions(c).filter { it.id != s.id } + s,
            System.currentTimeMillis(),
        )
        p(c).edit().putString(KEY_SESSIONS, WearStoreCodec.encodeSessions(next)).apply()
    }

    /** 폰 전달 결과 반영 — WearDataSender 의 putDataItem 성공/실패 콜백이 호출한다.
     *  sent=false 인 세션은 보관 한도와 무관하게 남아 재전송할 수 있다. */
    fun markSent(c: Context, sessionId: String, sent: Boolean) {
        val cur = sessions(c)
        if (cur.none { it.id == sessionId }) return
        val next = cur.map { if (it.id == sessionId) it.copy(sent = sent) else it }
        p(c).edit().putString(KEY_SESSIONS, WearStoreCodec.encodeSessions(next)).apply()
    }

    fun hapticEnabled(c: Context): Boolean = p(c).getBoolean(KEY_HAPTIC, true)
    fun setHaptic(c: Context, on: Boolean) = p(c).edit().putBoolean(KEY_HAPTIC, on).apply()

    // AOD 설정 — 화면 항상 켜기(KEEP_SCREEN_ON) / 앰비언트 간소 화면
    fun screenOnEnabled(c: Context): Boolean = p(c).getBoolean("screen_on", false)
    fun setScreenOn(c: Context, on: Boolean) = p(c).edit().putBoolean("screen_on", on).apply()
    fun ambientEnabled(c: Context): Boolean = p(c).getBoolean("ambient", true)
    fun setAmbient(c: Context, on: Boolean) = p(c).edit().putBoolean("ambient", on).apply()

    // 짐 모드 — 켜면 머신 스테이션 종료 시 PM5 연결을 해제해 공유 머신을 점유하지 않는다.
    // 기본 꺼짐(홈트) = 시뮬 내내 연결 유지로 흐름 끊김 없음.
    fun gymModeEnabled(c: Context): Boolean = p(c).getBoolean("gym_mode", false)
    fun setGymMode(c: Context, on: Boolean) = p(c).edit().putBoolean("gym_mode", on).apply()

    // 머신 종류별로 기억한 PM5 MAC — 스캔에서 보이면 RSSI 대기 없이 즉시 연결.
    // 스키와 로잉은 물리적으로 다른 모니터라 반드시 따로 저장한다.
    fun pm5Mac(c: Context, machine: String): String? = p(c).getString("pm5_mac_$machine", null)
    fun setPm5Mac(c: Context, machine: String, mac: String) =
        p(c).edit().putString("pm5_mac_$machine", mac).apply()
    fun clearPm5Macs(c: Context) =
        p(c).edit().remove("pm5_mac_ski").remove("pm5_mac_row").apply()
}
