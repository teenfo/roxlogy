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
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException

/**
 * 안드로이드 FCM 구독 등록/해제 — RPC `register_fcm_token`(SECURITY DEFINER) 사용.
 * RPC가 같은 기기 토큰을 물고 있는 **다른 계정 행을 정리**해 공유 기기에서 이전 사용자
 * 알림이 새는 문제를 막는다. service role 미사용: anon 키 + 사용자 JWT.
 *
 * 옵트아웃은 로컬에도 영속(SharedPreferences) — 앱 재시작 시 자동 재등록이 사용자의
 * "끄기" 선택을 되살리지 않게 한다.
 *
 * Firebase(google-services.json)가 설정돼 있을 때만 실제 동작하고, 없으면 조용히 no-op —
 * 앱은 그대로 빌드·동작한다(웹 임베드는 유지).
 */
object PushRegistration {
    private val client = OkHttpClient()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val JSON = "application/json; charset=utf-8".toMediaType()
    private const val TAG = "RoxPush"
    private const val PREFS = "rox_push"
    private const val KEY_OPTED_OUT = "opted_out"

    /** Firebase 초기화 여부(= google-services.json 존재). */
    fun isConfigured(context: Context): Boolean =
        runCatching { FirebaseApp.getApps(context).isNotEmpty() }.getOrDefault(false)

    /** OS 알림 표시 권한 허용 여부. */
    fun notificationsEnabled(context: Context): Boolean =
        NotificationManagerCompat.from(context).areNotificationsEnabled()

    /** 사용자가 앱 알림을 명시적으로 껐는지 (설정 화면 '끄기'). */
    fun isOptedOut(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(KEY_OPTED_OUT, false)

    private fun setOptedOut(context: Context, value: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putBoolean(KEY_OPTED_OUT, value).apply()
    }

    /** 설정 화면 토글 상태: 설정됨 + 권한 허용 + 옵트아웃 아님. */
    fun isEnabled(context: Context): Boolean =
        isConfigured(context) && notificationsEnabled(context) && !isOptedOut(context)

    /**
     * FCM 토큰을 받아 서버에 등록. 로그인 + Firebase 설정 + 옵트아웃 아님일 때만.
     * [fromUser]=true 면 사용자가 '켜기'를 누른 것 — 옵트아웃 플래그를 해제하고 진행.
     */
    fun register(context: Context, fromUser: Boolean = false) {
        if (!isConfigured(context)) return
        if (TokenStore.accessToken() == null) return
        if (fromUser) setOptedOut(context, false)
        else if (isOptedOut(context)) return // 자동 재등록이 사용자의 '끄기'를 되살리면 안 됨
        runCatching {
            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                if (!task.isSuccessful) {
                    Log.w(TAG, "FCM 토큰 획득 실패", task.exception)
                    return@addOnCompleteListener
                }
                val token = task.result
                if (token.isNullOrBlank()) return@addOnCompleteListener
                uploadToken(context, token)
            }
        }
    }

    /** onNewToken 등에서 토큰을 직접 알 때 등록(옵트아웃이면 스킵). */
    fun uploadToken(context: Context, fcmToken: String) {
        if (isOptedOut(context)) return
        val access = TokenStore.accessToken() ?: return
        scope.launch {
            val payload = JSONObject()
                .put("p_token", fcmToken)
                .put("p_ua", "android/${Build.MODEL}")
                .toString()
            val req = Request.Builder()
                .url("${SupabaseConfig.REST_URL}/rpc/register_fcm_token")
                .addHeader("apikey", SupabaseConfig.ANON_KEY)
                .addHeader("Authorization", "Bearer $access")
                .addHeader("Content-Type", "application/json")
                .post(payload.toByteArray().toRequestBody(JSON))
                .build()
            runCatching {
                client.newCall(req).execute().use { resp ->
                    if (!resp.isSuccessful) Log.w(TAG, "구독 등록 실패 ${resp.code}")
                }
            }.onFailure { if (it is IOException) Log.w(TAG, "구독 등록 네트워크 오류", it) }
        }
    }

    /**
     * 본 기기 구독 해제 — 서버 행 삭제 + FCM 토큰 폐기.
     * [fromUser]=true 면 사용자의 '끄기' — 옵트아웃 플래그를 영속해 자동 재등록을 막는다.
     * 로그아웃 경로에서는 fromUser=false 로 호출(다음 로그인 사용자의 선택을 침범하지 않게).
     */
    fun unregister(context: Context, fromUser: Boolean = false) {
        if (fromUser) setOptedOut(context, true)
        if (!isConfigured(context)) return
        val access = TokenStore.accessToken() ?: return
        runCatching {
            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                if (!task.isSuccessful) return@addOnCompleteListener
                val token = task.result
                if (!token.isNullOrBlank()) deleteRow(token, access)
                runCatching { FirebaseMessaging.getInstance().deleteToken() }
            }
        }
    }

    private fun deleteRow(fcmToken: String, access: String) {
        scope.launch {
            val req = Request.Builder()
                .url("${SupabaseConfig.REST_URL}/push_subscriptions?fcm_token=eq.$fcmToken")
                .addHeader("apikey", SupabaseConfig.ANON_KEY)
                .addHeader("Authorization", "Bearer $access")
                .addHeader("Prefer", "return=minimal")
                .delete()
                .build()
            runCatching { client.newCall(req).execute().use { } }
        }
    }
}
