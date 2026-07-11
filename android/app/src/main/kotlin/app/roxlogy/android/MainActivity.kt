package app.roxlogy.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import android.webkit.CookieManager
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
import app.roxlogy.android.ui.theme.RoxForeground
import app.roxlogy.android.ui.theme.RoxMuted
import app.roxlogy.android.ui.theme.RoxSurface
import app.roxlogy.android.ui.theme.RoxTrack
import app.roxlogy.android.ui.theme.RoxlogyTheme
import kotlinx.coroutines.launch

/**
 * 폰 앱 — Supabase 로그인/회원가입 → JWT 확보. 웹과 동일한 브랜드 디자인 시스템(다크·팔레트).
 * 로그인 후 오늘의 WOD 기록 + 최신 목표를 워치로 전달. 워치 시뮬 세션은 자동 업로드.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        TokenStore.init(applicationContext) // 저장된 세션 복원
        setContent { RoxlogyTheme { PhoneApp() } }
    }
}

@Composable
fun PhoneApp() {
    val context = LocalContext.current
    val auth = remember { AuthClient() }
    val google = remember { GoogleSignInHelper(context) }
    var loggedIn by remember { mutableStateOf(TokenStore.isLoggedIn()) }

    LaunchedEffect(loggedIn) {
        if (loggedIn) GoalSync().fetchAndPush(context) // 최신 목표를 워치로 밀어줌
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = androidx.compose.material3.MaterialTheme.colorScheme.background,
    ) {
        if (loggedIn) {
            // 웹앱(roxlogy.com)을 로그인 상태로 임베드 — 웹의 모든 기능 제공.
            // 워치연동(GoalSync/PhoneDataReceiver/IngestUploader)은 백그라운드로 계속 동작.
            WebAppScreen(
                onLoggedOut = {
                    TokenStore.clear()
                    CookieManager.getInstance().removeAllCookies(null)
                    loggedIn = false
                },
            )
        } else {
            AuthScreen(auth = auth, google = google, onAuthed = { loggedIn = true })
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
            style = androidx.compose.material3.MaterialTheme.typography.titleMedium,
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

@Composable
private fun HomeScreen(onOpenWod: () -> Unit, onLogout: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
    ) {
        // 헤더
        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RoxMark(size = 30.dp)
            Spacer(Modifier.width(10.dp))
            Text("ROXLOGY", fontWeight = FontWeight.Black, fontSize = 16.sp, letterSpacing = 3.sp)
            Spacer(Modifier.weight(1f))
            TextButton(onClick = onLogout) {
                Text("로그아웃", color = RoxMuted, fontSize = 13.sp)
            }
        }

        Spacer(Modifier.height(24.dp))

        // 오늘의 WOD 카드
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(RoxSurface, androidx.compose.material3.MaterialTheme.shapes.large)
                .padding(20.dp),
        ) {
            Text("오늘의 WOD", style = androidx.compose.material3.MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(6.dp))
            Text(
                "활성 프로그램의 오늘 워크아웃을 기록하고 무게·횟수를 남겨보세요.",
                color = RoxMuted,
                fontSize = 13.sp,
            )
            Spacer(Modifier.height(16.dp))
            RoxPrimaryButton(text = "오늘의 WOD 열기", onClick = onOpenWod)
        }

        Spacer(Modifier.height(16.dp))

        // 워치 동기화 안내
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(RoxSurface, androidx.compose.material3.MaterialTheme.shapes.large)
                .padding(20.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Spacer(Modifier.size(8.dp).background(RoxTrack, androidx.compose.foundation.shape.CircleShape))
                Spacer(Modifier.width(8.dp))
                Text("워치 연동", style = androidx.compose.material3.MaterialTheme.typography.titleMedium)
            }
            Spacer(Modifier.height(6.dp))
            Text(
                "워치 하이록스 시뮬 세션은 자동 업로드됩니다. 최신 목표도 워치로 전달돼 진행 중 diff가 표시됩니다.",
                color = RoxMuted,
                fontSize = 13.sp,
            )
        }
    }
}
