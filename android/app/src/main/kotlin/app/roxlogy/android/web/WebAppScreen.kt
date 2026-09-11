package app.roxlogy.android.web

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Environment
import android.text.TextUtils
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import app.roxlogy.android.push.RoxNativeBridge
import java.io.ByteArrayInputStream
import java.util.Locale

/**
 * 웹앱(roxlogy.com)을 임베드하는 메인 서피스.
 * - 네이티브 로그인 토큰을 주입해 자동 로그인(`WebConfig.startUrl`).
 * - 웹 도메인 내는 앱 내 유지, 외부 링크는 시스템 브라우저.
 * - CSV 등 다운로드는 DownloadManager로.
 * - 웹에서 로그아웃(→ `/login` 이동) 감지 시 [onLoggedOut] 호출.
 * - `RoxNative` JS 브리지로 네이티브 FCM 알림 제어(WebView는 Web Push 미지원).
 *   브리지 노출 경계(감사 R03)는 두 겹이다:
 *   1. [FramePolicy] — 이 WebView 에는 앱 출처 문서만 실린다(최상위·iframe 모두). 다른 출처의 문서 요청은
 *      네트워크 단계에서 정적 안내 페이지로 대체되므로 제3자 스크립트가 여기서 실행되는 일이 없다.
 *   2. [BridgeGate] — 그래도 최상위 프레임이 앱 출처가 아니면 브리지를 떼고, 돌아오면 다시 붙인다.
 *
 * @param startPath 최초 진입 경로(알림 탭 딥링크 등). 기본 /dashboard.
 * @param navTick 이동 신호(알림 탭·하단 탭) — 증가할 때마다 WebView를 startPath로 이동.
 *   (AndroidView factory는 최초 1회만 실행되므로 상태 변경만으로는 이동하지 않는다.)
 * @param onPathChanged 웹 내 경로 변경 통지 — 하단 탭 활성 상태 동기화용.
 * @param modifier 셸(Scaffold)이 인셋/패딩을 관리 — 기본은 전체 채움 + 키보드 인셋.
 */
@Composable
fun WebAppScreen(
    onLoggedOut: () -> Unit,
    startPath: String = "/dashboard",
    navTick: Int = 0,
    onPathChanged: (String) -> Unit = {},
    modifier: Modifier = Modifier.fillMaxSize(),
) {
    val context = LocalContext.current
    var webView by remember { mutableStateOf<WebView?>(null) }
    var canGoBack by remember { mutableStateOf(false) }

    BackHandler(enabled = canGoBack) { webView?.goBack() }

    // 알림 탭(딥링크)·하단 탭 → navTick 증가 → 해당 화면으로 이동
    LaunchedEffect(navTick) {
        if (navTick > 0) webView?.loadUrl(WebConfig.BASE_URL + startPath)
    }

    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            // 당겨서 새로고침 — WebView 를 SwipeRefreshLayout 으로 감싼다.
            // 페이지 스크롤을 가로채지 않도록 WebView 가 최상단일 때만 제스처를 받는다.
            val swipe = SwipeRefreshLayout(ctx).apply {
                layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                )
                setColorSchemeColors(0xFFFFD500.toInt())            // Race Yellow 스피너
                setProgressBackgroundColorSchemeColor(0xFF1F1F1F.toInt()) // Surface
            }
            val gate = BridgeGate(RoxNativeBridge(ctx.applicationContext))
            val web = WebView(ctx).apply {
                layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                )
                setBackgroundColor(0xFF141414.toInt())
                with(settings) {
                    javaScriptEnabled = true
                    domStorageEnabled = true
                    databaseEnabled = true
                    mediaPlaybackRequiresUserGesture = false
                    loadsImagesAutomatically = true
                }
                CookieManager.getInstance().setAcceptCookie(true)
                CookieManager.getInstance().setAcceptThirdPartyCookies(this, true) // this = WebView

                // 네이티브 FCM 제어용 브리지 — 첫 로드 전에 시작 URL 기준으로 부착 여부를 정한다.
                // (무조건 add 하지 않는 이유: BASE_URL 이 앱 출처 조건에 맞지 않는 빌드에서는 브리지를
                // 아예 노출하지 않기 위해. 시작 URL 은 항상 BASE_URL 기반이다.)
                val start = WebConfig.startUrl(startPath)
                gate.sync(this, Uri.parse(start))

                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(
                        view: WebView,
                        request: WebResourceRequest,
                    ): Boolean {
                        val uri = request.url
                        if (!WebConfig.isInApp(uri)) {
                            // 외부 링크(youtube, 공식 결과 등) → 시스템 브라우저.
                            // WebView 에는 싣지 않으므로 현재 페이지의 브리지 상태는 그대로 둔다.
                            runCatching {
                                context.startActivity(
                                    Intent(Intent.ACTION_VIEW, uri)
                                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                                )
                            }
                            return true
                        }
                        // 앱 내 유지. add/remove 는 다음 로드부터 반영되므로 이 내비게이션이
                        // 시작되기 전에 최상위 프레임 기준으로 상태를 맞춘다.
                        if (request.isForMainFrame) gate.sync(view, uri)
                        return false
                    }

                    override fun shouldInterceptRequest(
                        view: WebView,
                        request: WebResourceRequest,
                    ): WebResourceResponse? =
                        // 외부 프레임 정책 — 앱 출처가 아닌 문서 요청은 안내 페이지로 대체한다.
                        // (WebView 의 백그라운드 스레드에서 불리므로 view 를 만지지 않는다.)
                        FramePolicy.intercept(request) ?: super.shouldInterceptRequest(view, request)

                    override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                        // shouldOverrideUrlLoading 을 거치지 않은 로드(POST 제출·history 이동 등) 보정.
                        // 이미 커밋된 페이지에는 add/remove 가 반영되지 않으므로, 상태가 어긋났으면
                        // 멈추고 다시 로드한다. 두 번째 로드는 상태가 맞아 반복되지 않는다.
                        // (reload 는 콜백 안에서 내비게이션을 재진입하지 않도록 post 로 넘긴다.)
                        if (gate.sync(view, url?.let(Uri::parse))) {
                            view.stopLoading()
                            view.post { view.reload() }
                        }
                    }

                    override fun onPageFinished(view: WebView, url: String?) {
                        swipe.isRefreshing = false // 새로고침 스피너 종료
                    }

                    override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                        canGoBack = view.canGoBack()
                        val uri = url?.let(Uri::parse)
                        val path = uri?.path.orEmpty()
                        if (WebConfig.isInApp(uri)) {
                            // 웹 세션 종료(로그아웃/주입 실패) → 네이티브 로그인으로 복귀
                            if (path.startsWith("/login")) onLoggedOut()
                            else onPathChanged(path)
                        }
                    }
                }

                setDownloadListener { url, _, contentDisposition, mimeType, _ ->
                    runCatching {
                        val name = URLUtil.guessFileName(url, contentDisposition, mimeType)
                        val req = DownloadManager.Request(Uri.parse(url))
                            .setMimeType(mimeType)
                            .addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url).orEmpty())
                            .setNotificationVisibility(
                                DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED,
                            )
                            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
                        (context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
                    }
                }

                webView = this
                loadUrl(start)
            }
            swipe.addView(web)
            swipe.setOnRefreshListener { web.reload() }
            // WebView 가 위로 더 스크롤할 수 있으면(최상단이 아니면) 제스처를 넘긴다
            swipe.setOnChildScrollUpCallback { _, _ -> web.scrollY > 0 }
            swipe
        },
    )
}

/**
 * 외부 프레임 정책: 이 WebView 에는 앱 출처(`WebConfig.isInApp`) 문서만 싣는다 — 최상위 프레임과
 * 서브프레임(iframe) 모두. 다른 출처로 가는 "문서" 요청은 네트워크 단계([WebViewClient.shouldInterceptRequest])
 * 에서 가로채 스크립트 없는 정적 안내 페이지로 바꾼다. 안내 페이지의 링크는 `target="_top"` 이라 누르면
 * 최상위 내비게이션이 되고, 그건 shouldOverrideUrlLoading 이 시스템 브라우저로 내보낸다.
 *
 * 왜 이렇게 하나 — Android "Insecure WebView native bridges" 문서
 * (https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges):
 * addJavascriptInterface 로 주입한 객체는 페이지의 모든 프레임(교차 출처 iframe 포함)에 노출되고, 프레임
 * 단위로 뺄 방법이 없다(제거는 페이지 전체·다음 로드부터 — [BridgeGate]). 문서가 권하는 대안인
 * WebViewCompat.addWebMessageListener(허용 origin 목록)는 androidx.webkit 의존성과 웹 쪽 계약 변경
 * (동기 호출 → postMessage)이 함께 필요해 이번엔 쓰지 않았다. 대신 "제3자 문서가 이 WebView 안에서 실행되는
 * 일 자체"를 없앤다. 예외는 [EMBED_HOSTS] — 운동 상세의 YouTube 임베드
 * (web/app/(app)/exercises/[id]/page.tsx)는 서브프레임일 때만 그대로 싣는다.
 *
 * 문서 요청 판정: Chromium 은 프레임 내비게이션(문서) 요청에만 `Accept` 에 `text/html` 을 넣고 스크립트·
 * 이미지·CSS·fetch 기본값에는 넣지 않는다. `Sec-Fetch-Dest` 는 이 훅보다 뒤(네트워크 서비스)에서 붙어
 * 여기서는 보이지 않는다. Accept 가 없는 요청은 막지 않는다 — 그 경우 최상위 프레임은 [BridgeGate] 가 지킨다.
 * 이 판정과 실제 프레임 차단은 기기에서 검증하지 못했다(작업 환경에 Android SDK 없음).
 */
private object FramePolicy {
    /**
     * 그대로 싣는 제3자 임베드 호스트. 운동 상세의 YouTube 플레이어(privacy-enhanced 도메인)만 허용한다.
     * 브리지 표면([RoxNativeBridge] — 알림 켜기/끄기·워치 화면 열기)에 비밀값·쓰기 권한이 없고, 이 프레임을
     * 막으면 앱에서 운동 영상이 사라지는 회귀가 더 크다고 판단했다. 새 임베드를 추가할 때는 여기에 같이 올릴 것.
     */
    private val EMBED_HOSTS = setOf("www.youtube-nocookie.com", "www.youtube.com", "youtube.com")

    /** 앱 출처가 아닌 문서 요청이면 대체 응답, 아니면 null(정상 진행). 백그라운드 스레드에서 불린다. */
    fun intercept(request: WebResourceRequest): WebResourceResponse? {
        val uri = request.url ?: return null
        if (WebConfig.isInApp(uri)) return null
        if (request.isForMainFrame.not() && uri.scheme?.lowercase() == "https" &&
            uri.host?.lowercase() in EMBED_HOSTS
        ) return null
        if (!acceptsHtml(request)) return null
        return WebResourceResponse(
            "text/html",
            "utf-8",
            200,
            "OK",
            mapOf(
                // 안내 페이지에 스크립트·외부 리소스가 없음을 브라우저 단에서도 못 박는다(인라인 CSS 만 허용).
                "Content-Security-Policy" to "default-src 'none'; style-src 'unsafe-inline'",
                "X-Content-Type-Options" to "nosniff",
                "Cache-Control" to "no-store",
            ),
            ByteArrayInputStream(placeholderHtml(uri).toByteArray(Charsets.UTF_8)),
        )
    }

    private fun acceptsHtml(request: WebResourceRequest): Boolean {
        val accept = request.requestHeaders
            ?.entries
            ?.firstOrNull { it.key.equals("Accept", ignoreCase = true) }
            ?.value ?: return false
        return accept.contains("text/html", ignoreCase = true)
    }

    /**
     * 외부 리소스 없는 자체 완결 HTML. 문구는 앱 로케일(ko/es/그 외 en)로 고른다 — 문자열 리소스가 아닌
     * 이유는 WebView 안 콘텐츠라 웹 사전과 같은 세 언어만 맞추면 되기 때문. URL·호스트는 HTML 에 들어가므로
     * 이스케이프하고, 링크는 http(s) 일 때만 만든다.
     */
    private fun placeholderHtml(target: Uri): String {
        val lang = Locale.getDefault().language.ifBlank { "en" }
        val (message, action) = when (lang) {
            "ko" -> "앱 안에서는 외부 콘텐츠를 표시하지 않습니다." to "브라우저에서 열기"
            "es" -> "El contenido externo no se muestra dentro de la app." to "Abrir en el navegador"
            else -> "External content isn't shown inside the app." to "Open in browser"
        }
        val scheme = target.scheme?.lowercase()
        val link = if (scheme == "https" || scheme == "http") TextUtils.htmlEncode(target.toString()) else null
        val host = TextUtils.htmlEncode(target.host.orEmpty())
        val button = if (link != null) "<a href=\"$link\" target=\"_top\">$action</a>" else ""
        return """<!doctype html><html lang="$lang"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><style>
html,body{height:100%;margin:0}
body{display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:16px;background:#141414;color:#F4F4F2;font:14px/1.4 system-ui,sans-serif;text-align:center}
p{margin:0}
a{display:inline-block;margin-top:12px;padding:10px 18px;border-radius:999px;background:#FFD500;color:#141414;font-weight:700;text-decoration:none}
small{display:block;margin-top:10px;color:#8C8C8A;word-break:break-all}
</style></head><body><div><p>$message</p>$button<small>$host</small></div></body></html>
"""
    }
}

/**
 * `RoxNative` 브리지의 부착 상태를 최상위 프레임의 출처(앱 도메인 여부)에 맞춘다.
 *
 * 왜 이렇게 하나 — Android "Insecure WebView native bridges" 문서
 * (https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges):
 * addJavascriptInterface 로 주입한 객체는 WebView 에 실리는 콘텐츠 전체에 노출된다. 문서는
 * 신뢰하는 콘텐츠만 로드하고 그 밖의 URL 로 갈 때는 인터페이스를 제거하거나, 허용 origin 목록을
 * 받는 WebViewCompat.addWebMessageListener 로 대체하라고 권고한다. 후자는 androidx.webkit
 * 의존성이 없어(app/build.gradle.kts 확인) 전자를 택했다.
 *
 * add/remove 는 "다음 페이지 (재)로드부터" 반영된다(WebView API 문서). 그래서 내비게이션이
 * 시작되기 전(shouldOverrideUrlLoading)에 맞추고, 그 콜백을 거치지 않은 로드는 onPageStarted 에서
 * 바로잡은 뒤 다시 로드해 반영한다.
 *
 * 한계: 제거는 페이지 전체에 걸리므로 프레임 단위로는 못 가린다 — 교차 출처 iframe 은 [FramePolicy] 가
 * 문서 자체를 싣지 않는 방식으로 막는다. 이 게이트는 그 정책이 놓친 최상위 페이지(Accept 헤더가 없는
 * 요청 등)를 위한 두 번째 층이다.
 */
private class BridgeGate(private val bridge: RoxNativeBridge) {
    private var attached = false

    /**
     * [target] 이 앱 출처면 부착, 아니면 제거.
     * @return 상태가 바뀌었으면 true — 호출자가 (이미 로드 중이라면) 다시 로드해 반영할 책임이 있다.
     */
    fun sync(view: WebView, target: Uri?): Boolean {
        val trusted = WebConfig.isInApp(target)
        if (trusted == attached) return false
        if (trusted) view.addJavascriptInterface(bridge, NAME) else view.removeJavascriptInterface(NAME)
        attached = trusted
        return true
    }

    private companion object {
        /** 웹(web/lib/native.ts)이 `window.RoxNative` 로 찾는 이름 — 바꾸면 웹도 같이 바꿔야 한다. */
        const val NAME = "RoxNative"
    }
}
