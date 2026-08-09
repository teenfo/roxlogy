package app.roxlogy.android

import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Face
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import android.webkit.CookieManager
import app.roxlogy.android.push.PushController
import app.roxlogy.android.push.PushRegistration
import app.roxlogy.android.push.RoxMessagingService
import app.roxlogy.android.sync.AuthClient
import app.roxlogy.android.sync.GoalSync
import app.roxlogy.android.sync.GoogleSignInHelper
import app.roxlogy.android.sync.TokenStore
import app.roxlogy.android.web.WebAppScreen
import app.roxlogy.android.ui.OrDivider
import app.roxlogy.android.ui.RoxMark
import app.roxlogy.android.ui.RoxOutlineButton
import app.roxlogy.android.ui.RoxPrimaryButton
import app.roxlogy.android.ui.RoxTextField
import app.roxlogy.android.ui.theme.RoxAccent
import app.roxlogy.android.ui.theme.RoxError
import app.roxlogy.android.ui.theme.RoxMuted
import app.roxlogy.android.ui.theme.RoxSurface
import app.roxlogy.android.ui.theme.RoxTrack
import app.roxlogy.android.ui.theme.RoxlogyTheme
import kotlinx.coroutines.launch

/**
 * 폰 앱 — Supabase 로그인/회원가입 → JWT 확보. 웹과 동일한 브랜드 디자인 시스템(다크·팔레트).
 * 로그인 후: 네이티브 하단 5탭(홈·세션·워치·피드·더보기) + WebView(roxlogy.com) 하이브리드.
 * 워치 탭만 네이티브(연결·목표전송·WOD), 나머지는 웹 화면. 워치연동은 백그라운드 상시 동작.
 */
class MainActivity : ComponentActivity() {
    private var startPath by mutableStateOf("/dashboard")
    private var navTick by mutableStateOf(0) // 실행 중 알림 탭 → WebView 재이동 신호
    private lateinit var notifPermLauncher: ActivityResultLauncher<String>
    private var enableTrigger: (() -> Unit)? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // 크래시 핸들러는 RoxApp.attachBaseContext 에서 이미 설치됨(더 이른 시점)
        // 시작 초기화가 앱을 통째로 죽이지 않게 — 실패해도 화면은 뜨고 원인은 크래시 로그로 남는다
        runCatching { TokenStore.init(applicationContext) } // 저장된 세션 복원
        runCatching { RoxMessagingService.ensureChannel(this) }

        // 알림 권한 요청 결과 — 허용 시 FCM 토큰 등록(사용자 '켜기' → 옵트아웃 해제)
        notifPermLauncher = registerForActivityResult(
            ActivityResultContracts.RequestPermission(),
        ) { PushRegistration.register(applicationContext, fromUser = true) }

        // 웹 브리지(RoxNative.enable)가 부르는 "앱 알림 켜기" 트리거
        val trigger: () -> Unit = {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                !PushRegistration.notificationsEnabled(this)
            ) {
                notifPermLauncher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
            } else {
                PushRegistration.register(applicationContext, fromUser = true)
            }
        }
        enableTrigger = trigger
        PushController.requestEnable = trigger

        readDeepLink(intent)
        setContent { RoxlogyTheme { PhoneApp(startPath, navTick) } }
    }

    override fun onDestroy() {
        // 정적 컨트롤러가 파괴된 액티비티(런처)를 잡고 있지 않게 — 우리 람다일 때만 해제
        if (PushController.requestEnable === enableTrigger) PushController.requestEnable = null
        super.onDestroy()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        readDeepLink(intent)
    }

    private fun readDeepLink(intent: Intent?) {
        // 포그라운드 수신 알림은 EXTRA_URL, 백그라운드(시스템 트레이) 알림은 FCM data 키 "url"로 도착.
        val raw = intent?.getStringExtra(RoxMessagingService.EXTRA_URL)
            ?: intent?.getStringExtra("url")
            ?: return
        // 앱 내 상대경로만 신뢰(외부 URL 주입 방지)
        if (raw.startsWith("/") && !raw.startsWith("//")) {
            startPath = raw
            navTick++ // 이미 실행 중이면 WebView에 재이동 신호
        }
    }
}

/** 하단 탭. route=null 은 네이티브 화면(워치). */
private enum class RoxTab(val label: String, val route: String?, val icon: ImageVector?) {
    HOME("홈", "/dashboard", Icons.Filled.Home),
    SESSIONS("세션", "/sessions", Icons.AutoMirrored.Filled.List),
    WATCH("워치", null, null), // 브랜드 마크 아이콘 사용
    CREW("크루", "/crews", Icons.Filled.Face),
    FEED("피드", "/feed", Icons.Filled.Person),
    MORE("더보기", "/settings/profile", Icons.Filled.Menu),
}

/** 웹 경로 → 하이라이트할 탭 (웹 안에서 링크로 이동해도 하단 탭 동기화). */
private fun tabForPath(path: String): RoxTab? = when {
    path == "/" || path.startsWith("/dashboard") -> RoxTab.HOME
    path.startsWith("/sessions") || path.startsWith("/workouts") -> RoxTab.SESSIONS
    path.startsWith("/crews") -> RoxTab.CREW
    path.startsWith("/feed") || path.startsWith("/members") || path.startsWith("/u/") ||
        path.startsWith("/leaderboard") -> RoxTab.FEED
    path.startsWith("/settings") || path.startsWith("/goals") || path.startsWith("/programs") ||
        path.startsWith("/races") || path.startsWith("/predict") -> RoxTab.MORE
    else -> null
}

@Composable
fun PhoneApp(startPath: String = "/dashboard", navTick: Int = 0) {
    val context = LocalContext.current
    val auth = remember { AuthClient() }
    val google = remember { GoogleSignInHelper(context) }
    var loggedIn by remember { mutableStateOf(TokenStore.isLoggedIn()) }

    // WebView 이동 상태(하단 탭·알림 딥링크 공용) + 활성 탭
    var tab by remember { mutableStateOf(tabForPath(startPath) ?: RoxTab.HOME) }
    var webPath by remember { mutableStateOf(startPath) }
    var webTick by remember { mutableIntStateOf(0) }

    // 알림 딥링크(Activity → props): 실행 중 탭하면 해당 화면으로
    LaunchedEffect(navTick) {
        if (navTick > 0) {
            webPath = startPath
            webTick++
            tab = tabForPath(startPath) ?: tab.takeIf { it != RoxTab.WATCH } ?: RoxTab.HOME
        }
    }

    LaunchedEffect(loggedIn) {
        if (loggedIn) {
            // 로그인 전에 도착해 건너뛴 워치 세션 회수 — 업로드 재시도가 길어질 수 있어
            // 별도 코루틴으로 떼어낸다(아래 목표·WOD 동기화를 막지 않도록).
            launch {
                runCatching { app.roxlogy.android.sync.PendingSessionSync().uploadPending(context) }
            }
            runCatching { GoalSync().fetchAndPush(context) } // 최신 목표를 워치로 밀어줌
            runCatching { app.roxlogy.android.sync.WodSync().fetchAndPush(context) } // 오늘의 WOD 도
            // 이미 알림 권한이 있으면 FCM 토큰을 조용히 (재)등록 — 서버 발송 대상 최신화.
            // (사용자가 설정에서 '끄기'를 눌렀다면 register 내부의 옵트아웃 체크가 스킵)
            runCatching {
                if (PushRegistration.isConfigured(context) && PushRegistration.notificationsEnabled(context)) {
                    PushRegistration.register(context)
                }
            }
        }
    }

    // 직전 실행이 크래시로 끝났으면 원인을 화면에 보여준다 (사이드로드라 adb 없이는 볼 방법이 없다)
    var crash by remember { mutableStateOf(CrashLog.last(context)) }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        crash?.let { trace ->
            CrashReportScreen(
                trace = trace,
                onDismiss = { CrashLog.clear(context); crash = null },
            )
            return@Surface
        }
        if (!loggedIn) {
            AuthScreen(auth = auth, google = google, onAuthed = { loggedIn = true })
            return@Surface
        }

        fun openWeb(path: String) {
            webPath = path
            webTick++
            tab = tabForPath(path) ?: RoxTab.HOME
        }

        Scaffold(
            containerColor = MaterialTheme.colorScheme.background,
            bottomBar = {
                RoxBottomBar(current = tab, onSelect = { t ->
                    if (t == RoxTab.WATCH) tab = RoxTab.WATCH
                    else t.route?.let { openWeb(it) }
                })
            },
        ) { pad ->
            Box(Modifier.fillMaxSize().padding(pad)) {
                // WebView 는 항상 컴포지션 유지(탭 전환에도 세션·스크롤 보존) — 워치 탭은 위에 오버레이.
                WebAppScreen(
                    onLoggedOut = {
                        // 순서 중요: 구독 해제(delete + 토큰 폐기)는 아직 유효한 액세스 토큰이 필요.
                        // 지우지 않으면 이 기기의 다음 사용자에게 이전 계정 알림이 계속 온다.
                        PushRegistration.unregister(context)
                        TokenStore.clear()
                        CookieManager.getInstance().removeAllCookies(null)
                        loggedIn = false
                    },
                    startPath = webPath,
                    navTick = webTick,
                    onPathChanged = { p -> if (tab != RoxTab.WATCH) tabForPath(p)?.let { tab = it } },
                    modifier = Modifier.fillMaxSize().imePadding(),
                )
                if (tab == RoxTab.WATCH) {
                    Box(
                        Modifier
                            .fillMaxSize()
                            .imePadding(),
                    ) {
                        Surface(
                            modifier = Modifier.fillMaxSize(),
                            color = MaterialTheme.colorScheme.background,
                        ) {
                            WatchScreen(
                                onOpenWeb = { p -> openWeb(p) },
                                onBack = { tab = RoxTab.HOME },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun RoxBottomBar(current: RoxTab, onSelect: (RoxTab) -> Unit) {
    NavigationBar(containerColor = RoxSurface) {
        RoxTab.entries.forEach { t ->
            NavigationBarItem(
                selected = current == t,
                onClick = { onSelect(t) },
                icon = {
                    if (t.icon != null) {
                        Icon(t.icon, contentDescription = t.label)
                    } else {
                        // 워치 탭(중앙) — 브랜드 마크로 앱 고유 가치를 강조
                        Image(
                            painter = painterResource(R.drawable.ic_rox_mark),
                            contentDescription = t.label,
                            modifier = Modifier.size(26.dp),
                        )
                    }
                },
                label = { Text(t.label, fontSize = 11.sp) },
                colors = NavigationBarItemDefaults.colors(
                    selectedIconColor = RoxAccent,
                    selectedTextColor = RoxAccent,
                    unselectedIconColor = RoxMuted,
                    unselectedTextColor = RoxMuted,
                    indicatorColor = RoxAccent.copy(alpha = 0.14f),
                ),
            )
        }
    }
}

@Composable
private fun AuthScreen(
    auth: AuthClient,
    google: GoogleSignInHelper,
    onAuthed: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var isSignup by remember { mutableStateOf(false) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var reveal by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    fun submit() {
        busy = true; error = null; notice = null
        scope.launch {
            val r = if (isSignup) auth.signUp(email, password) else auth.signIn(email, password)
            busy = false
            when (r) {
                is AuthClient.Result.Ok -> onAuthed()
                is AuthClient.Result.NeedsConfirm ->
                    notice = "확인 메일을 보냈습니다. 메일의 링크로 인증 후 로그인하세요."
                is AuthClient.Result.Error ->
                    error = if (isSignup) "회원가입 실패: ${r.message}" else "이메일 또는 비밀번호가 올바르지 않습니다."
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 28.dp, vertical = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        RoxMark(size = 64.dp)
        Spacer(Modifier.height(14.dp))
        Text("ROXLOGY", fontWeight = FontWeight.Black, fontSize = 22.sp, letterSpacing = 4.sp)
        Spacer(Modifier.height(4.dp))
        Text(
            if (isSignup) "계정 만들기" else "로그인",
            color = RoxMuted,
            style = MaterialTheme.typography.titleMedium,
        )

        Spacer(Modifier.height(28.dp))

        RoxTextField(
            value = email,
            onValueChange = { email = it },
            label = "이메일",
            keyboardType = KeyboardType.Email,
        )
        Spacer(Modifier.height(12.dp))
        RoxTextField(
            value = password,
            onValueChange = { password = it },
            label = "비밀번호",
            keyboardType = KeyboardType.Password,
            visualTransformation = if (reveal) VisualTransformation.None else PasswordVisualTransformation(),
            trailingIcon = {
                TextButton(onClick = { reveal = !reveal }) {
                    Text(if (reveal) "숨기기" else "보기", color = RoxMuted, fontSize = 12.sp)
                }
            },
        )

        error?.let {
            Spacer(Modifier.height(10.dp))
            Text(it, color = RoxError, fontSize = 13.sp)
        }
        notice?.let {
            Spacer(Modifier.height(10.dp))
            Text(it, color = RoxTrack, fontSize = 13.sp)
        }

        Spacer(Modifier.height(18.dp))
        RoxPrimaryButton(
            text = if (busy) "처리 중…" else if (isSignup) "회원가입" else "로그인",
            onClick = { submit() },
            enabled = !busy && email.isNotBlank() && password.isNotBlank(),
        )

        if (google.isConfigured()) {
            Spacer(Modifier.height(18.dp))
            OrDivider("또는")
            Spacer(Modifier.height(18.dp))
            RoxOutlineButton(
                text = "Google로 계속하기",
                onClick = {
                    busy = true; error = null
                    scope.launch {
                        val idToken = google.getIdToken()
                        if (idToken == null) {
                            error = "Google 로그인 취소/실패"
                        } else {
                            when (val r = auth.signInWithGoogle(idToken)) {
                                is AuthClient.Result.Ok -> onAuthed()
                                is AuthClient.Result.Error -> error = "Google 로그인 실패: ${r.message}"
                                else -> {}
                            }
                        }
                        busy = false
                    }
                },
            )
        }

        Spacer(Modifier.height(22.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                if (isSignup) "이미 계정이 있으신가요?" else "계정이 없으신가요?",
                color = RoxMuted,
                fontSize = 13.sp,
            )
            TextButton(onClick = { isSignup = !isSignup; error = null; notice = null }) {
                Text(if (isSignup) "로그인" else "회원가입", color = RoxAccent, fontSize = 13.sp)
            }
        }
    }
}

/**
 * 직전 크래시 리포트 화면 — 스토어 배포가 아니라 사용자가 스택트레이스를 볼 방법이
 * 이것뿐이다. 길게 눌러 복사한 뒤 개발자에게 전달하면 원인을 바로 좁힐 수 있다.
 */
@Composable
private fun CrashReportScreen(trace: String, onDismiss: () -> Unit) {
    val clipboard = LocalClipboardManager.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(20.dp)
            .verticalScroll(rememberScrollState()),
    ) {
        Text("앱이 비정상 종료됐습니다", fontSize = 18.sp, color = RoxAccent)
        Spacer(Modifier.height(6.dp))
        Text(
            "직전 실행에서 발생한 오류입니다. 복사해서 알려주시면 원인을 바로 찾을 수 있습니다.",
            fontSize = 13.sp, color = RoxMuted,
        )
        Spacer(Modifier.height(14.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { clipboard.setText(AnnotatedString(trace)) }) {
                Text("오류 복사", color = RoxAccent, fontSize = 14.sp)
            }
            TextButton(onClick = onDismiss) {
                Text("닫고 계속", color = RoxMuted, fontSize = 14.sp)
            }
        }
        Spacer(Modifier.height(10.dp))
        Text(trace, fontSize = 11.sp, color = RoxMuted)
    }
}
