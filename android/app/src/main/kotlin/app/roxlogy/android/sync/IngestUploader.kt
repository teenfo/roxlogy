package app.roxlogy.android.sync

import kotlinx.coroutines.delay
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

/**
 * `ingest-session` 업로드 (okhttp). 재시도/백오프 판단은 :shared UploadRetry로 위임.
 * service role 키 미사용 — anon 키 + 사용자 JWT(Authorization Bearer)로만 호출.
 */
class IngestUploader(
    private val client: OkHttpClient = OkHttpClient(),
) {
    /** 단발 POST — HTTP 상태코드 반환, 네트워크 오류는 null. */
    fun postOnce(json: String, accessToken: String, anonKey: String): Int? {
        val body = json.toByteArray().toRequestBody(JSON)
        val request = Request.Builder()
            .url(SupabaseConfig.INGEST_URL)
            .addHeader("Authorization", "Bearer $accessToken")
            .addHeader("apikey", anonKey)
            .addHeader("Content-Type", "application/json")
            .post(body)
            .build()
        return try {
            client.newCall(request).execute().use { it.code }
        } catch (_: IOException) {
            null
        }
    }

    /**
     * 재시도 루프. 성공(2xx)이면 true, 최종 실패면 false.
     * 401은 tokenRefresh로 새 토큰을 받아 1회 재시도한다(널이면 포기).
     */
    suspend fun upload(
        json: String,
        initialToken: String,
        anonKey: String = SupabaseConfig.ANON_KEY,
        tokenRefresh: suspend () -> String? = { null },
    ): Boolean {
        var token = initialToken
        var authRetried = false
        var attempt = 1
        while (true) {
            val status = postOnce(json, token, anonKey)
            if (status != null && app.roxlogy.shared.sync.UploadRetry.isSuccess(status)) return true

            when (val d = app.roxlogy.shared.sync.UploadRetry.decide(status, attempt, authRetried)) {
                is app.roxlogy.shared.sync.RetryDecision.Retry -> {
                    delay(d.delayMs)
                    attempt++
                }
                app.roxlogy.shared.sync.RetryDecision.RefreshAuthThenRetry -> {
                    val fresh = tokenRefresh() ?: return false
                    token = fresh
                    authRetried = true
                    // attempt는 유지 — 인증 재시도는 백오프 카운트와 분리
                }
                app.roxlogy.shared.sync.RetryDecision.GiveUp -> return false
            }
        }
    }

    companion object {
        private val JSON = "application/json; charset=utf-8".toMediaType()
    }
}
