package app.roxlogy.android.sync

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
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
 *
 * 백업: 이 파일(`rox_tokens.xml`)은 res/xml/backup_rules.xml·data_extraction_rules.xml 에서 백업·기기
 * 이전 대상에서 제외한다 — 마스터키(Android Keystore)는 따라가지 않아 복원해도 복호화되지 않는다(감사 R05).
 */
object TokenStore {
    private const val TAG = "RoxToken"

    /** EncryptedSharedPreferences 파일명. 백업 제외 규칙(res/xml)의 `rox_tokens.xml` 과 같아야 한다. */
    const val PREFS_NAME = "rox_tokens"

    @Volatile
    private var access: String? = null

    @Volatile
    private var refresh: String? = null

    @Volatile
    private var prefs: SharedPreferences? = null

    /** 열기 + 읽기가 모두 성공했을 때의 결과. */
    private class Opened(val prefs: SharedPreferences, val access: String?, val refresh: String?)

    /**
     * 앱 시작 시 1회. 암호화 저장소를 열고 저장된 토큰을 메모리로 복원.
     *
     * 복호화 실패(키 불일치) 처리: 파일이 남아 있는 한 실패가 매 실행 반복돼 새 로그인도 영영 저장되지
     * 않으므로(이전에는 조용히 메모리 전용으로 빠졌다), 파일을 지우고 한 번 더 연다. 결과적으로 토큰이
     * 없어지고 MainActivity 가 로그인 화면을 띄운다(재로그인). 대표 원인: 백업/기기 이전으로 파일만
     * 복원되고 마스터키(Android Keystore)는 새 것일 때, 또는 Keystore 초기화.
     *
     * 동기화: 콜드스타트 때 MainActivity 와 RoxMessagingService(백그라운드 스레드)가 동시에 부를 수
     * 있어 리셋 경로가 겹치지 않게 한다.
     */
    @Synchronized
    fun init(context: Context) {
        if (prefs != null) return
        val app = context.applicationContext

        // 마스터키 확보 실패는 파일 문제가 아니므로 파일을 지우지 않는다 — 이번 실행은 메모리 전용.
        // (Keystore 의 일시 장애로 멀쩡한 세션을 날리지 않기 위해 파일 열기와 분리했다.)
        val masterKeyAlias = runCatching { MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC) }
            .onFailure { Log.w(TAG, "master key unavailable: ${it.javaClass.simpleName}") }
            .getOrNull() ?: return

        val opened = openAndRead(app, masterKeyAlias) ?: run {
            Log.w(TAG, "token store unreadable with current master key; resetting (re-login required)")
            runCatching { app.deleteSharedPreferences(PREFS_NAME) }
                .onFailure { Log.w(TAG, "delete token store failed: ${it.javaClass.simpleName}") }
            openAndRead(app, masterKeyAlias)
        } ?: return // 두 번 다 실패 — 이번 실행은 메모리 전용(이전 동작과 같음)

        prefs = opened.prefs
        access = opened.access
        refresh = opened.refresh
    }

    /**
     * 저장소를 열고 토큰을 읽는다. create() 는 키셋 복호화 실패, getString() 은 값 복호화 실패
     * (SecurityException)를 던지므로 둘 다 같은 runCatching 안에 둔다. 실패하면 null.
     */
    private fun openAndRead(app: Context, masterKeyAlias: String): Opened? = runCatching {
        val p = EncryptedSharedPreferences.create(
            PREFS_NAME,
            masterKeyAlias,
            app,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
        Opened(p, p.getString(KEY_ACCESS, null), p.getString(KEY_REFRESH, null))
    }.onFailure {
        // 메시지에 토큰이 섞일 일은 없지만, 클래스명만 남겨 로그를 단순하게 유지한다.
        Log.w(TAG, "token store open/read failed: ${it.javaClass.simpleName}")
    }.getOrNull()

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
