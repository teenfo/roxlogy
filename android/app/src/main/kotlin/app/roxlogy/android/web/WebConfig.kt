package app.roxlogy.android.web

import android.net.Uri
import app.roxlogy.android.BuildConfig
import app.roxlogy.android.sync.TokenStore

/** 임베드하는 웹앱(roxlogy.com) 설정 + 네이티브→웹 자동 로그인 URL 빌더. */
object WebConfig {
    val BASE_URL: String = BuildConfig.WEB_APP_URL.trimEnd('/')

    /** 웹앱 도메인 여부(외부 링크 판별용). */
    fun isInApp(host: String?): Boolean {
        if (host == null) return false
        val base = Uri.parse(BASE_URL).host ?: return false
        return host == base || host.endsWith(".$base")
    }

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
