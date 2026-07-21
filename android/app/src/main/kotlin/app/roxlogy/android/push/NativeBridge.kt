package app.roxlogy.android.push

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface

/**
 * Activity ↔ 네이티브 푸시 연결점. Activity가 권한 요청 트리거를 등록하면
 * WebView JS 브리지가 이를 호출한다(메인 스레드).
 */
object PushController {
    /** POST_NOTIFICATIONS 권한 요청(허용 시 등록)을 트리거. Activity가 onCreate에서 설정. */
    @Volatile
    var requestEnable: (() -> Unit)? = null
}

/**
 * WebView에 `RoxNative`로 주입되는 브리지. 웹 설정 화면이 앱(WebView) 안임을 감지하고
 * 네이티브 FCM 알림을 켜고/끌 수 있게 한다. (Web Push는 WebView 미지원이라 이 경로가 대체.)
 *
 * 주의: roxlogy.com 페이지만 WebView에 로드되므로(외부 링크는 시스템 브라우저) 노출 범위는 자기 도메인.
 */
class RoxNativeBridge(private val context: Context) {
    /** 앱(WebView) 안에서 실행 중인지 — 웹은 이 객체 존재로 판별. */
    @JavascriptInterface
    fun isAvailable(): Boolean = true

    /** Firebase(FCM) 설정 완료 여부. false면 앱 알림 아직 준비 전(google-services.json 필요). */
    @JavascriptInterface
    fun isConfigured(): Boolean = PushRegistration.isConfigured(context)

    /** OS 알림 권한 허용 여부. */
    @JavascriptInterface
    fun hasPermission(): Boolean = PushRegistration.notificationsEnabled(context)

    /** 앱 알림 켜기 — 권한 요청 후 FCM 토큰 등록(메인 스레드에서 실행). */
    @JavascriptInterface
    fun enable() {
        Handler(Looper.getMainLooper()).post { PushController.requestEnable?.invoke() }
    }

    /** 앱 알림 끄기 — 구독 해제 + 토큰 폐기. */
    @JavascriptInterface
    fun disable() {
        PushRegistration.unregister(context)
    }
}
