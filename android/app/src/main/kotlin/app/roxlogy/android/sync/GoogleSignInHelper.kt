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

    private val credentialManager = CredentialManager.create(context)

    fun isConfigured(): Boolean = SupabaseConfig.GOOGLE_WEB_CLIENT_ID.isNotBlank()

    suspend fun getIdToken(): String? {
        if (!isConfigured()) return null
        return try {
            val option = GetGoogleIdOption.Builder()
                .setServerClientId(SupabaseConfig.GOOGLE_WEB_CLIENT_ID)
                .setFilterByAuthorizedAccounts(false)
                .build()
            val request = GetCredentialRequest.Builder()
                .addCredentialOption(option)
                .build()
            val response = credentialManager.getCredential(context, request)
            GoogleIdTokenCredential.createFrom(response.credential.data).idToken
        } catch (_: Exception) {
            null
        }
    }
}
