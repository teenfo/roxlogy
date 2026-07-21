package app.roxlogy.android.push

import android.content.Context
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import app.roxlogy.android.sync.SupabaseConfig
import app.roxlogy.android.sync.TokenStore
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

/**
 * 안드로이드 FCM 구독 등록/해제 — push_subscriptions(platform='android').
 * service role 미사용: anon 키 + 사용자 JWT + RLS(본인 행만). user_id 는 컬럼 기본값 auth.uid().
 *
 * Firebase(google-services.json)가 설정돼 있을 때만 실제 동작하고, 없으면 조용히 no-op —
 * 앱은 그대로 빌드·동작한다(웹 임베드는 유지).
 */
object PushRegistration {
    private val client = OkHttpClient()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val JSON = "application/json; charset=utf-8".toMediaType()
    private const val TAG = "RoxPush"

    /** Firebase 초기화 여부(= google-services.json 존재). */
    fun isConfigured(context: Context): Boolean =
        runCatching { FirebaseApp.getApps(context).isNotEmpty() }.getOrDefault(false)

    /** OS 알림 표시 권한 허용 여부. */
    fun notificationsEnabled(context: Context): Boolean =
        NotificationManagerCompat.from(context).areNotificationsEnabled()

    /**
     * FCM 토큰을 받아 서버에 업서트. 로그인 + Firebase 설정 시에만.
     * 권한이 없어도 토큰 등록은 가능하지만(추후 허용 대비), 보통 권한 허용 직후 호출한다.
     */
    fun register(context: Context) {
        if (!isConfigured(context)) return
        if (TokenStore.accessToken() == null) return
        runCatching {
            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                val token = task.result
                if (!task.isSuccessful || token.isNullOrBlank()) {
                    Log.w(TAG, "FCM 토큰 획득 실패", task.exception)
                    return@addOnCompleteListener
                }
                uploadToken(token)
            }
        }
    }

    /** onNewToken 등에서 토큰을 직접 알 때 업서트. */
    fun uploadToken(fcmToken: String) {
        val access = TokenStore.accessToken() ?: return
        scope.launch {
            val url = "${SupabaseConfig.REST_URL}/push_subscriptions".toHttpUrl().newBuilder()
                .addQueryParameter("on_conflict", "user_id,fcm_token")
                .build()
            val row = JSONObject()
                .put("platform", "android")
                .put("fcm_token", fcmToken)
                .put("ua", "android/${Build.MODEL}")
                .put("disabled", false)
            val payload = JSONArray().put(row).toString()
            val req = Request.Builder()
                .url(url)
                .addHeader("apikey", SupabaseConfig.ANON_KEY)
                .addHeader("Authorization", "Bearer $access")
                .addHeader("Content-Type", "application/json")
                .addHeader("Prefer", "resolution=merge-duplicates,return=minimal")
                .post(payload.toByteArray().toRequestBody(JSON))
                .build()
            runCatching {
                client.newCall(req).execute().use { resp ->
                    if (!resp.isSuccessful) Log.w(TAG, "구독 업서트 실패 ${resp.code}")
                }
            }.onFailure { if (it is IOException) Log.w(TAG, "구독 업서트 네트워크 오류", it) }
        }
    }

    /** 본 기기 구독 해제 — 서버 행 삭제 + FCM 토큰 폐기. */
    fun unregister(context: Context) {
        if (!isConfigured(context)) return
        val access = TokenStore.accessToken() ?: return
        runCatching {
            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                val token = task.result ?: return@addOnCompleteListener
                deleteRow(token, access)
                runCatching { FirebaseMessaging.getInstance().deleteToken() }
            }
        }
    }

    private fun deleteRow(fcmToken: String, access: String) {
        scope.launch {
            val url = "${SupabaseConfig.REST_URL}/push_subscriptions".toHttpUrl().newBuilder()
                .addQueryParameter("fcm_token", "eq.$fcmToken")
                .build()
            val req = Request.Builder()
                .url(url)
                .addHeader("apikey", SupabaseConfig.ANON_KEY)
                .addHeader("Authorization", "Bearer $access")
                .addHeader("Prefer", "return=minimal")
                .delete()
                .build()
            runCatching { client.newCall(req).execute().use { } }
        }
    }
}
