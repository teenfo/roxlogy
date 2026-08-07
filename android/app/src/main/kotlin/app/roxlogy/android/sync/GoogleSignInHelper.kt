package app.roxlogy.android.sync

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential

/**
 * Credential Manager로 Google ID 토큰을 획득. 이 토큰을 AuthClient.signInWithGoogle으로
 * Supabase 세션과 교환한다. WEB_CLIENT_ID(Google Cloud OAuth) 미설정이면 null.
 */
class GoogleSignInHelper(private val context: Context) {

    // 생성 시점이 아니라 실제로 쓸 때 만든다 — Credential Manager 초기화가 기기/Play
    // 서비스 상태에 따라 던지면 로그인 화면이 뜨기도 전에 앱이 죽어버린다.
    private val credentialManager by lazy { runCatching { CredentialManager.create(context) }.getOrNull() }

    fun isConfigured(): Boolean = SupabaseConfig.GOOGLE_WEB_CLIENT_ID.isNotBlank()

    suspend fun getIdToken(): String? {
        if (!isConfigured()) return null
        val cm = credentialManager ?: return null
        return try {
            val option = GetGoogleIdOption.Builder()
                .setServerClientId(SupabaseConfig.GOOGLE_WEB_CLIENT_ID)
                .setFilterByAuthorizedAccounts(false)
                .build()
            val request = GetCredentialRequest.Builder()
                .addCredentialOption(option)
                .build()
            val response = cm.getCredential(context, request)
            GoogleIdTokenCredential.createFrom(response.credential.data).idToken
        } catch (_: Exception) {
            null
        }
    }
}
