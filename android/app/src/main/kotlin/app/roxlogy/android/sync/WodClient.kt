package app.roxlogy.android.sync

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * 오늘의 WOD 조회/완료/기록 — Supabase PostgREST 직접 호출(okhttp + kotlinx.serialization).
 * service role 미사용: anon 키 + 사용자 JWT로만 접근하며 RLS로 본인 데이터만 다룬다.
 * 웹의 워크아웃 상세(WOD 체크리스트 + 무게 기록)와 동일한 workout_item_completions 테이블 사용.
 */
class WodClient(
    private val client: OkHttpClient = OkHttpClient(),
) {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    data class WodItem(
        val itemId: String,
        val name: String,
        val targetNote: String?,
        val done: Boolean,
        val weightKg: Double?,
        val reps: Int?,
        val note: String?,
    )

    data class Wod(val title: String, val dayNumber: Int, val items: List<WodItem>)

    /** 활성 프로그램 등록 → 시작일 기준 오늘의 day_index → 해당 워크아웃 + 내 완료/기록. */
    suspend fun loadToday(access: String, koreanNames: Boolean = true): Wod? =
        withContext(Dispatchers.IO) {
            val select =
                "start_date,programs(id,title,program_days(day_index," +
                    "workout_templates(id,title,workout_template_items(id,seq,target," +
                    "exercises(id,name_ko,name_en)))))"
            val url = "${SupabaseConfig.REST_URL}/program_enrollments".toHttpUrl().newBuilder()
                .addQueryParameter("active", "eq.true")
                .addQueryParameter("select", select)
                .build()
            val body = get(url.toString(), access) ?: return@withContext null
            val enrollments = runCatching {
                json.decodeFromString(ListSerializer(EnrollmentRow.serializer()), body)
            }.getOrNull() ?: return@withContext null
            val enroll = enrollments.firstOrNull() ?: return@withContext null
            val program = enroll.programs ?: return@withContext null

            val start = runCatching { LocalDate.parse(enroll.start_date) }.getOrNull()
                ?: return@withContext null
            val dayNumber = (ChronoUnit.DAYS.between(start, LocalDate.now()) + 1).toInt()
            if (dayNumber < 1) return@withContext null
            val day = program.program_days.firstOrNull { it.day_index == dayNumber }
                ?: return@withContext null
            val template = day.workout_templates.firstOrNull() ?: return@withContext null
            val items = template.workout_template_items.sortedBy { it.seq }

            val byItem = loadCompletions(access, items.map { it.id }).associateBy { it.item_id }
            val wodItems = items.map { it ->
                val c = byItem[it.id]
                WodItem(
                    itemId = it.id,
                    name = it.exercises?.let { ex -> if (koreanNames) ex.name_ko else ex.name_en }
                        ?: "—",
                    targetNote = (it.target as? JsonObject)?.get("note")?.jsonPrimitive?.contentOrNull,
                    done = c != null,
                    weightKg = c?.weight_kg,
                    reps = c?.reps,
                    note = c?.note,
                )
            }
            Wod(template.title, dayNumber, wodItems)
        }

    private fun loadCompletions(access: String, itemIds: List<String>): List<CompletionRow> {
        if (itemIds.isEmpty()) return emptyList()
        val url = "${SupabaseConfig.REST_URL}/workout_item_completions".toHttpUrl().newBuilder()
            .addQueryParameter("item_id", "in.(${itemIds.joinToString(",")})")
            .addQueryParameter("select", "item_id,weight_kg,reps,note")
            .build()
        val body = get(url.toString(), access) ?: return emptyList()
        return runCatching {
            json.decodeFromString(ListSerializer(CompletionRow.serializer()), body)
        }.getOrDefault(emptyList())
    }

    /** 운동 완료 토글. done=true면 완료행 삽입(멱등), false면 삭제. */
    suspend fun setComplete(itemId: String, done: Boolean, access: String): Boolean =
        withContext(Dispatchers.IO) {
            if (done) upsert(listOf(LogUpsert(itemId)), access, merge = false)
            else delete(itemId, access)
        }

    /** 수행 무게/횟수/메모 저장(완료 처리 포함). */
    suspend fun saveLog(
        itemId: String,
        weightKg: Double?,
        reps: Int?,
        note: String?,
        access: String,
    ): Boolean = withContext(Dispatchers.IO) {
        upsert(listOf(LogUpsert(itemId, weightKg, reps, note)), access, merge = true)
    }

    private fun upsert(rows: List<LogUpsert>, access: String, merge: Boolean): Boolean {
        val url = "${SupabaseConfig.REST_URL}/workout_item_completions".toHttpUrl().newBuilder()
            .addQueryParameter("on_conflict", "user_id,item_id")
            .build()
        val prefer =
            if (merge) "resolution=merge-duplicates,return=minimal"
            else "resolution=ignore-duplicates,return=minimal"
        val payload = json.encodeToString(ListSerializer(LogUpsert.serializer()), rows)
        val request = Request.Builder()
            .url(url)
            .addHeader("apikey", SupabaseConfig.ANON_KEY)
            .addHeader("Authorization", "Bearer $access")
            .addHeader("Content-Type", "application/json")
            .addHeader("Prefer", prefer)
            .post(payload.toByteArray().toRequestBody(JSON))
            .build()
        return exec(request)
    }

    private fun delete(itemId: String, access: String): Boolean {
        val url = "${SupabaseConfig.REST_URL}/workout_item_completions".toHttpUrl().newBuilder()
            .addQueryParameter("item_id", "eq.$itemId")
            .build()
        val request = Request.Builder()
            .url(url)
            .addHeader("apikey", SupabaseConfig.ANON_KEY)
            .addHeader("Authorization", "Bearer $access")
            .addHeader("Prefer", "return=minimal")
            .delete()
            .build()
        return exec(request)
    }

    private fun get(url: String, access: String): String? {
        val request = Request.Builder()
            .url(url)
            .addHeader("apikey", SupabaseConfig.ANON_KEY)
            .addHeader("Authorization", "Bearer $access")
            .addHeader("Accept", "application/json")
            .get()
            .build()
        return try {
            client.newCall(request).execute().use { resp ->
                if (resp.isSuccessful) resp.body?.string() else null
            }
        } catch (_: IOException) {
            null
        }
    }

    private fun exec(request: Request): Boolean = try {
        client.newCall(request).execute().use { it.isSuccessful }
    } catch (_: IOException) {
        false
    }

    @Serializable
    private data class EnrollmentRow(val start_date: String, val programs: ProgramRow? = null)

    @Serializable
    private data class ProgramRow(
        val id: String,
        val title: String,
        val program_days: List<DayRow> = emptyList(),
    )

    @Serializable
    private data class DayRow(
        val day_index: Int,
        val workout_templates: List<TemplateRow> = emptyList(),
    )

    @Serializable
    private data class TemplateRow(
        val id: String,
        val title: String,
        val workout_template_items: List<ItemRow> = emptyList(),
    )

    @Serializable
    private data class ItemRow(
        val id: String,
        val seq: Int,
        val target: JsonElement? = null,
        val exercises: ExRow? = null,
    )

    @Serializable
    private data class ExRow(val id: String, val name_ko: String, val name_en: String)

    @Serializable
    private data class CompletionRow(
        val item_id: String,
        val weight_kg: Double? = null,
        val reps: Int? = null,
        val note: String? = null,
    )

    @Serializable
    private data class LogUpsert(
        val item_id: String,
        val weight_kg: Double? = null,
        val reps: Int? = null,
        val note: String? = null,
    )

    companion object {
        private val JSON = "application/json; charset=utf-8".toMediaType()
    }
}
