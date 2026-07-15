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
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView

/**
 * 웹앱(roxlogy.com)을 임베드하는 메인 서피스.
 * - 네이티브 로그인 토큰을 주입해 자동 로그인(`WebConfig.startUrl`).
 * - 웹 도메인 내는 앱 내 유지, 외부 링크는 시스템 브라우저.
 * - CSV 등 다운로드는 DownloadManager로.
 * - 웹에서 로그아웃(→ `/login` 이동) 감지 시 [onLoggedOut] 호출.
 */
@Composable
fun WebAppScreen(onLoggedOut: () -> Unit) {
    val context = LocalContext.current
    var webView by remember { mutableStateOf<WebView?>(null) }
    var canGoBack by remember { mutableStateOf(false) }

    BackHandler(enabled = canGoBack) { webView?.goBack() }

    AndroidView(
        // 상태바/네비바/키보드 인셋만큼 여백 — 웹 콘텐츠가 상단 시간표시줄과 겹치지 않게.
        modifier = Modifier.fillMaxSize().safeDrawingPadding(),
        factory = { ctx ->
            WebView(ctx).apply {
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

                    override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                        canGoBack = view.canGoBack()
                        // 웹 세션 종료(로그아웃/주입 실패) → 네이티브 로그인으로 복귀
                        val path = url?.let { Uri.parse(it).path }.orEmpty()
                        if (WebConfig.isInApp(url?.let { Uri.parse(it).host }) && path.startsWith("/login")) {
                            onLoggedOut()
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
                loadUrl(WebConfig.startUrl())
            }
        },
    )
}
