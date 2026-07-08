package app.roxlogy.android.sync

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

/**
 * Supabase Auth(GoTrue) REST 직접 호출 — 이메일/비밀번호 로그인 + 토큰 갱신.
 * supabase-kt/ktor 없이 기존 okhttp + kotlinx.serialization만 사용.
 * 성공 시 TokenStore에 액세스·리프레시 토큰을 보관한다.
 */
class AuthClient(
    private val client: OkHttpClient = OkHttpClient(),
) {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    sealed interface Result {
        data object Ok : Result
        data class Error(val message: String) : Result
    }

    /** 이메일/비밀번호 로그인. 성공 시 TokenStore 갱신. */
    suspend fun signIn(email: String, password: String): Result = withContext(Dispatchers.IO) {
        val body = json.encodeToString(
            PasswordGrant.serializer(),
            PasswordGrant(email.trim(), password),
        )
        post("${SupabaseConfig.AUTH_TOKEN_URL}?grant_type=password", body)
    }

    /** 리프레시 토큰으로 새 액세스 토큰 발급. 성공 시 새 액세스 토큰 반환(널이면 실패). */
    suspend fun refreshAccessToken(): String? = withContext(Dispatchers.IO) {
        val rt = TokenStore.refreshToken() ?: return@withContext null
        val body = json.encodeToString(RefreshGrant.serializer(), RefreshGrant(rt))
        when (post("${SupabaseConfig.AUTH_TOKEN_URL}?grant_type=refresh_token", body)) {
            is Result.Ok -> TokenStore.accessToken()
            is Result.Error -> null
        }
    }

    private fun post(url: String, jsonBody: String): Result {
        val request = Request.Builder()
            .url(url)
            .addHeader("apikey", SupabaseConfig.ANON_KEY)
            .addHeader("Content-Type", "application/json")
            .post(jsonBody.toByteArray().toRequestBody(JSON))
            .build()
        return try {
            client.newCall(request).execute().use { resp ->
                val text = resp.body?.string().orEmpty()
                if (resp.isSuccessful) {
                    val token = json.decodeFromString(TokenResponse.serializer(), text)
                    TokenStore.set(token.access_token, token.refresh_token)
                    Result.Ok
                } else {
                    Result.Error("HTTP ${resp.code}")
                }
            }
        } catch (e: IOException) {
            Result.Error(e.message ?: "network error")
        } catch (e: Exception) {
            Result.Error(e.message ?: "auth error")
        }
    }

    @Serializable
    private data class PasswordGrant(val email: String, val password: String)

    @Serializable
    private data class RefreshGrant(val refresh_token: String)

    @Serializable
    private data class TokenResponse(
        val access_token: String,
        val refresh_token: String,
        val expires_in: Int? = null,
    )

    companion object {
        private val JSON = "application/json; charset=utf-8".toMediaType()
    }
}
