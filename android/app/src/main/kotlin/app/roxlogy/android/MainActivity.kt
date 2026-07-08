package app.roxlogy.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import app.roxlogy.android.sync.AuthClient
import app.roxlogy.android.sync.TokenStore
import kotlinx.coroutines.launch

/**
 * N5b 폰 화면 — Supabase 로그인으로 JWT 확보 → TokenStore.
 * 로그인 후 워치에서 도착하는 세션을 PhoneDataReceiver가 자동 업로드한다.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme { PhoneApp() } }
    }
}

@Composable
fun PhoneApp() {
    val scope = rememberCoroutineScope()
    val auth = remember { AuthClient() }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var loggedIn by remember { mutableStateOf(TokenStore.isLoggedIn()) }
    var status by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text("ROXLOGY", style = MaterialTheme.typography.headlineMedium)

        if (loggedIn) {
            Text(
                "로그인됨 — 워치 세션이 자동 업로드됩니다.",
                modifier = Modifier.padding(top = 16.dp),
            )
        } else {
            OutlinedTextField(
                value = email,
                onValueChange = { email = it },
                label = { Text("이메일") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                modifier = Modifier.padding(top = 16.dp),
            )
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("비밀번호") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                modifier = Modifier.padding(top = 8.dp),
            )
            Button(
                onClick = {
                    busy = true
                    status = null
                    scope.launch {
                        when (val r = auth.signIn(email, password)) {
                            is AuthClient.Result.Ok -> {
                                loggedIn = true
                                status = null
                            }
                            is AuthClient.Result.Error -> status = "로그인 실패: ${r.message}"
                        }
                        busy = false
                    }
                },
                enabled = !busy && email.isNotBlank() && password.isNotBlank(),
                modifier = Modifier.padding(top = 16.dp),
            ) {
                Text(if (busy) "로그인 중…" else "로그인")
            }
            status?.let {
                Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp))
            }
        }
    }
}
