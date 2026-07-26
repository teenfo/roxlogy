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

    fun hapticEnabled(c: Context): Boolean = p(c).getBoolean(KEY_HAPTIC, true)
    fun setHaptic(c: Context, on: Boolean) = p(c).edit().putBoolean(KEY_HAPTIC, on).apply()
}
