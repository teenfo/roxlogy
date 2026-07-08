package app.roxlogy.android.sync

/**
 * Supabase 클라이언트 설정.
 * anon(publishable) 키는 공개 키라 클라이언트 포함이 안전하다.
 * **service role 키는 절대 포함 금지** (서버/워커 전용 — 루트 CLAUDE.md).
 * 실제 anon 키는 빌드시 주입(BuildConfig/CI 시크릿) 권장 — 여기서는 자리표시자.
 */
object SupabaseConfig {
    const val PROJECT_URL = "https://vuloxbpfhyqkvgmpmkst.supabase.co"
    const val INGEST_URL = "$PROJECT_URL/functions/v1/ingest-session"

    // TODO(N5b): BuildConfig로 주입. anon 키는 공개 키이므로 노출 자체는 문제 없음.
    const val ANON_KEY = ""
}

/**
 * Supabase Auth 액세스 토큰 저장소 (N5b에서 supabase-kt 로그인과 연결).
 * 지금은 자리표시자 — 토큰이 없으면 업로드는 보류된다.
 */
object TokenStore {
    @Volatile
    private var accessToken: String? = null

    fun setAccessToken(token: String?) {
        accessToken = token
    }

    fun accessToken(): String? = accessToken
}
