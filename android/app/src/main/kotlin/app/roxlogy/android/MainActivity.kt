package app.roxlogy.android

import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
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
import app.roxlogy.android.push.ShellController
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
import app.roxlogy.android.ui.theme.RoxTrack
import app.roxlogy.android.ui.theme.RoxlogyTheme
import kotlinx.coroutines.launch

/**
 * 폰 앱 — Supabase 로그인/회원가입 → JWT 확보. 웹과 동일한 브랜드 디자인 시스템(다크·팔레트).
 * 로그인 후: WebView(roxlogy.com) 하이브리드. 하단 탭바는 **웹이 그린다** — 웹 탭바(nav.ts)가
 * 단일 출처이고, 앱 안에서는 거기에 "워치" 탭이 하나 더 붙어 `RoxNative.openWatch()` 로
 * 네이티브 워치 화면(연결·목표전송·WOD)을 오버레이로 연다. (v0.7: 네이티브 탭바 제거 —
 * 웹이 모바일 하단 탭바를 갖게 되면서 두 겹이 됐고, 탭 목록도 서로 어긋났다)
 * 워치연동은 백그라운드 상시 동작.
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

@Composable
fun PhoneApp(startPath: String = "/dashboard", navTick: Int = 0) {
    val context = LocalContext.current
    val auth = remember { AuthClient() }
    val google = remember { GoogleSignInHelper(context) }
    var loggedIn by remember { mutableStateOf(TokenStore.isLoggedIn()) }

    // WebView 이동 상태(알림 딥링크 공용) + 워치 오버레이
    var webPath by remember { mutableStateOf(startPath) }
    var webTick by remember { mutableIntStateOf(0) }
    var watchOpen by remember { mutableStateOf(false) }

    // 웹 탭바의 "워치" 탭 → 브리지 → 여기. 컴포지션이 사라지면 참조를 놓는다.
    DisposableEffect(Unit) {
        val open: () -> Unit = { watchOpen = true }
        ShellController.openWatch = open
        onDispose { if (ShellController.openWatch === open) ShellController.openWatch = null }
    }

    // 알림 딥링크(Activity → props): 실행 중 탭하면 해당 웹 화면으로 (워치가 열려 있으면 닫는다)
    LaunchedEffect(navTick) {
        if (navTick > 0) {
            webPath = startPath
            webTick++
            watchOpen = false
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
            watchOpen = false
        }

        // bottomBar 없음 — 하단 탭바는 웹이 그린다. Scaffold 는 시스템 바 인셋만 준다.
        Scaffold(containerColor = MaterialTheme.colorScheme.background) { pad ->
            Box(Modifier.fillMaxSize().padding(pad)) {
                // WebView 는 항상 컴포지션 유지(워치를 열었다 닫아도 세션·스크롤 보존) — 워치는 위에 오버레이.
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
                    modifier = Modifier.fillMaxSize().imePadding(),
                )
                if (watchOpen) {
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
                                onBack = { watchOpen = false },
                            )
                        }
                    }
                }
            }
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
