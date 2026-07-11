package app.roxlogy.android.sync

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import app.roxlogy.android.BuildConfig

/**
 * Supabase 클라이언트 설정.
 * anon 키는 **공개(publishable) 키**라 클라이언트 포함이 안전하다 (웹앱도 동일 키 사용).
 * **service role 키는 절대 포함 금지** (서버/워커·CI 전용 — 루트 CLAUDE.md).
 */
object SupabaseConfig {
    const val PROJECT_URL = "https://vuloxbpfhyqkvgmpmkst.supabase.co"
    const val INGEST_URL = "$PROJECT_URL/functions/v1/ingest-session"
    const val AUTH_TOKEN_URL = "$PROJECT_URL/auth/v1/token"
    const val SIGNUP_URL = "$PROJECT_URL/auth/v1/signup"
    const val REST_URL = "$PROJECT_URL/rest/v1"

    // Google 로그인용 웹 클라이언트 ID (Google Cloud OAuth). Supabase Google 프로바이더에
    // 등록된 것과 동일해야 한다. 빌드시 env(ROXLOGY_GOOGLE_WEB_CLIENT_ID) 또는
    // gradle property(roxlogyGoogleWebClientId)로 주입한다(소스/커밋 금지).
    // 값이 없으면 빈 문자열 → 앱에서 Google 버튼 비활성.
    val GOOGLE_WEB_CLIENT_ID: String = BuildConfig.GOOGLE_WEB_CLIENT_ID

    // 공개 anon 키 (JWT). 노출돼도 RLS로 보호되므로 안전.
    const val ANON_KEY =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
            "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1bG94YnBmaHlxa3ZnbXBta3N0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyMTc0NzgsImV4cCI6MjA5ODc5MzQ3OH0." +
            "WhmfRIZWBS88_Rf-e_p7tMpOLKEX9kKxC67KVrLZGjs"
}

/**
 * Supabase Auth 토큰 저장소 (액세스 + 리프레시).
 * 메모리 캐시 + EncryptedSharedPreferences 영속(콜드스타트 후 로그인 복원, WebView 세션 주입 시드).
 * 앱 시작 시 [init]을 한 번 호출해 디스크에서 복원한다.
 */
object TokenStore {
    @Volatile
    private var access: String? = null

    @Volatile
    private var refresh: String? = null

    @Volatile
    private var prefs: SharedPreferences? = null

    /** 앱 시작 시 1회. 암호화 저장소를 열고 저장된 토큰을 메모리로 복원. */
    fun init(context: Context) {
        if (prefs != null) return
        val p = runCatching {
            val masterKeyAlias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
            EncryptedSharedPreferences.create(
                "rox_tokens",
                masterKeyAlias,
                context.applicationContext,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        }.getOrNull() ?: return
        prefs = p
        access = p.getString(KEY_ACCESS, null)
        refresh = p.getString(KEY_REFRESH, null)
    }

    fun set(accessToken: String?, refreshToken: String?) {
        access = accessToken
        refresh = refreshToken
        prefs?.edit()?.putString(KEY_ACCESS, accessToken)?.putString(KEY_REFRESH, refreshToken)?.apply()
    }

    fun accessToken(): String? = access
    fun refreshToken(): String? = refresh
    fun isLoggedIn(): Boolean = access != null

    fun clear() {
        access = null
        refresh = null
        prefs?.edit()?.remove(KEY_ACCESS)?.remove(KEY_REFRESH)?.apply()
    }

    private const val KEY_ACCESS = "access"
    private const val KEY_REFRESH = "refresh"
}
