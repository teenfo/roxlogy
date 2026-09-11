package app.roxlogy.android.web

import android.net.Uri
import app.roxlogy.android.BuildConfig
import app.roxlogy.android.sync.TokenStore

/** 임베드하는 웹앱(roxlogy.com) 설정 + 네이티브→웹 자동 로그인 URL 빌더. */
object WebConfig {
    /**
     * 임베드할 웹앱 기준 URL. 빌드 시 `ROXLOGY_WEB_APP_URL`(env) 또는 `roxlogyWebAppUrl`(gradle property) 로
     * 바꿀 수 있다(app/build.gradle.kts).
     *
     * **https 필수.** [isInApp] 이 https 만 앱 출처로 보므로 `http://localhost:3000` 같은 값으로 빌드하면 브리지가
     * 붙지 않고 모든 링크·프레임이 "외부"로 취급된다(그 전에 targetSdk 28+ 의 평문 트래픽 기본 차단에 먼저 걸린다).
     * 로컬 웹을 앱에 물리려면 https 터널(cloudflared·ngrok 등)의 URL 을 넣을 것.
     */
    val BASE_URL: String = BuildConfig.WEB_APP_URL.trimEnd('/')

    /** BASE_URL 호스트에서 `www.` 를 뗀 apex. 허용 호스트는 apex 와 `www.<apex>` 둘뿐이다. */
    private val apexHost: String? = Uri.parse(BASE_URL).host?.lowercase()?.removePrefix("www.")

    /** BASE_URL 에 명시된 포트(없으면 -1). */
    private val basePort: Int = Uri.parse(BASE_URL).port

    /**
     * 앱 내(신뢰) 출처 여부 — "앱 내 유지 vs 시스템 브라우저" 분기와 `RoxNative` 브리지 노출 판정에 쓴다.
     *
     * 조건: scheme 은 https 만, host 는 BASE_URL 호스트와 정확히 같거나 `www.` 가 붙은 것만,
     * port 는 BASE_URL 과 같아야 한다(명시하지 않은 포트는 https 기본값 443 으로 본다).
     *
     * 왜: 이전 구현은 host 만 보고 모든 하위 도메인(`*.roxlogy.com`)을 허용해, 다른 서비스에 위임된
     * 서브도메인이나 다른 scheme/port 가 앱 출처로 취급돼 브리지가 노출될 수 있었다(감사 R03).
     * http 를 배제해도 잃는 것은 없다 — targetSdk 28+ 의 WebView 는 평문 트래픽을 기본 차단한다.
     */
    fun isInApp(uri: Uri?): Boolean {
        if (uri == null || apexHost == null) return false
        if (uri.scheme?.lowercase() != "https") return false
        val host = uri.host?.lowercase() ?: return false
        if (host != apexHost && host != "www.$apexHost") return false
        return effectivePort(uri.port) == effectivePort(basePort)
    }

    private fun effectivePort(port: Int): Int = if (port == -1) 443 else port

    /**
     * 최초 로드 URL. 저장된 토큰이 있으면 `/auth/native#...`로 세션을 주입한다.
     * 토큰은 URL 해시(서버 미전송) + HTTPS로만 전달된다.
     */
    fun startUrl(next: String = "/dashboard"): String {
        val at = TokenStore.accessToken()
        val rt = TokenStore.refreshToken()
        return if (at != null && rt != null) {
            "$BASE_URL/auth/native#access_token=${Uri.encode(at)}" +
                "&refresh_token=${Uri.encode(rt)}&next=${Uri.encode(next)}"
        } else {
            "$BASE_URL$next"
        }
    }
}
