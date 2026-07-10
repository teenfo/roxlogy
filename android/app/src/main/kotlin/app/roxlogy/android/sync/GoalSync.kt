package app.roxlogy.android.sync

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException

/**
 * 폰이 최신 goal_plans(웹 목표)를 PostgREST로 조회해 Data Layer로 워치에 전달.
 * 워치는 토큰이 없어 직접 조회 불가 → 폰이 대신 조회·푸시. 워치는 WearGoal.load로 수신.
 * service role 금지 — anon 키 + 사용자 JWT(TokenStore).
 */
class GoalSync(
    private val client: OkHttpClient = OkHttpClient(),
) {
    private val json = Json { ignoreUnknownKeys = true }
    val goalPath = "/roxlogy/goal"

    suspend fun fetchAndPush(context: Context): Boolean = withContext(Dispatchers.IO) {
        val access = TokenStore.accessToken() ?: return@withContext false
        val row = fetchLatest(access) ?: return@withContext false

        val req = PutDataMapRequest.create(goalPath)
        val m = req.dataMap
        m.putLong("target", row.target_total_ms ?: 0L)
        m.putLong("run", row.run_total_ms ?: 0L)
        m.putLong("station", row.station_total_ms ?: 0L)
        m.putLong("roxzone", row.roxzone_total_ms ?: 0L)
        val st = row.stations ?: emptyList()
        m.putStringArray("stKeys", st.map { it.key }.toTypedArray())
        m.putLongArray("stVals", st.map { it.targetMs }.toLongArray())
        m.putLong("ts", System.currentTimeMillis()) // 갱신 강제 (값 동일해도 반영)

        return@withContext try {
            Tasks.await(
                Wearable.getDataClient(context)
                    .putDataItem(req.asPutDataRequest().setUrgent()),
            )
            true
        } catch (_: Exception) {
            false
        }
    }

    private fun fetchLatest(access: String): GoalRow? {
        val url = "${SupabaseConfig.REST_URL}/goal_plans".toHttpUrl().newBuilder()
            .addQueryParameter(
                "select",
                "target_total_ms,run_total_ms,station_total_ms,roxzone_total_ms,stations",
            )
            .addQueryParameter("order", "created_at.desc")
            .addQueryParameter("limit", "1")
            .build()
        val request = Request.Builder()
            .url(url)
            .addHeader("apikey", SupabaseConfig.ANON_KEY)
            .addHeader("Authorization", "Bearer $access")
            .addHeader("Accept", "application/json")
            .get()
            .build()
        return try {
            client.newCall(request).execute().use { resp ->
                if (!resp.isSuccessful) return null
                val body = resp.body?.string() ?: return null
                json.decodeFromString(ListSerializer(GoalRow.serializer()), body).firstOrNull()
            }
        } catch (_: IOException) {
            null
        }
    }

    @Serializable
    private data class GoalRow(
        val target_total_ms: Long? = null,
        val run_total_ms: Long? = null,
        val station_total_ms: Long? = null,
        val roxzone_total_ms: Long? = null,
        val stations: List<StationTarget>? = null,
    )

    @Serializable
    private data class StationTarget(val key: String, val targetMs: Long)
}
