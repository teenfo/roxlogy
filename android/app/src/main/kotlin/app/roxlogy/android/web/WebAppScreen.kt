package app.roxlogy.android.web

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.WebResourceRequest
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

/**
 * 웹앱(roxlogy.com)을 임베드하는 메인 서피스.
 * - 네이티브 로그인 토큰을 주입해 자동 로그인(`WebConfig.startUrl`).
 * - 웹 도메인 내는 앱 내 유지, 외부 링크는 시스템 브라우저.
 * - CSV 등 다운로드는 DownloadManager로.
 * - 웹에서 로그아웃(→ `/login` 이동) 감지 시 [onLoggedOut] 호출.
 * - `RoxNative` JS 브리지로 네이티브 FCM 알림 제어(WebView는 Web Push 미지원).
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
                // 네이티브 FCM 제어용 브리지(roxlogy.com 페이지만 로드됨).
                addJavascriptInterface(RoxNativeBridge(ctx.applicationContext), "RoxNative")

                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(
                        view: WebView,
                        request: WebResourceRequest,
                    ): Boolean {
                        val uri = request.url
                        if (WebConfig.isInApp(uri.host)) return false // 앱 내 유지
                        // 외부 링크(youtube, 공식 결과 등) → 시스템 브라우저
                        runCatching {
                            context.startActivity(
                                Intent(Intent.ACTION_VIEW, uri)
                                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                            )
                        }
                        return true
                    }

                    override fun onPageFinished(view: WebView, url: String?) {
                        swipe.isRefreshing = false // 새로고침 스피너 종료
                    }

                    override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                        canGoBack = view.canGoBack()
                        val path = url?.let { Uri.parse(it).path }.orEmpty()
                        if (WebConfig.isInApp(url?.let { Uri.parse(it).host })) {
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
                loadUrl(WebConfig.startUrl(startPath))
            }
            swipe.addView(web)
            swipe.setOnRefreshListener { web.reload() }
            // WebView 가 위로 더 스크롤할 수 있으면(최상단이 아니면) 제스처를 넘긴다
            swipe.setOnChildScrollUpCallback { _, _ -> web.scrollY > 0 }
            swipe
        },
    )
}
