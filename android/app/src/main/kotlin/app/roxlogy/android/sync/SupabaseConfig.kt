package app.roxlogy.android.sync

/**
 * Supabase 클라이언트 설정.
 * anon 키는 **공개(publishable) 키**라 클라이언트 포함이 안전하다 (웹앱도 동일 키 사용).
 * **service role 키는 절대 포함 금지** (서버/워커·CI 전용 — 루트 CLAUDE.md).
 */
object SupabaseConfig {
    const val PROJECT_URL = "https://vuloxbpfhyqkvgmpmkst.supabase.co"
    const val INGEST_URL = "$PROJECT_URL/functions/v1/ingest-session"
    const val AUTH_TOKEN_URL = "$PROJECT_URL/auth/v1/token"

    // Google 로그인용 웹 클라이언트 ID (Google Cloud OAuth). Supabase Google 프로바이더에
    // 등록된 것과 동일해야 한다. 값이 없으면 Google 버튼은 비활성.
    // TODO(N5c): Google Cloud OAuth 웹 클라이언트 ID 주입.
    const val GOOGLE_WEB_CLIENT_ID = ""

    // 공개 anon 키 (JWT). 노출돼도 RLS로 보호되므로 안전.
    const val ANON_KEY =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
            "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1bG94YnBmaHlxa3ZnbXBta3N0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyMTc0NzgsImV4cCI6MjA5ODc5MzQ3OH0." +
            "WhmfRIZWBS88_Rf-e_p7tMpOLKEX9kKxC67KVrLZGjs"
}

/** Supabase Auth 토큰 저장소 (액세스 + 리프레시). 프로세스 메모리 보관. */
object TokenStore {
    @Volatile
    private var access: String? = null

    @Volatile
    private var refresh: String? = null

    fun set(accessToken: String?, refreshToken: String?) {
        access = accessToken
        refresh = refreshToken
    }

    fun accessToken(): String? = access
    fun refreshToken(): String? = refresh
    fun isLoggedIn(): Boolean = access != null
}
