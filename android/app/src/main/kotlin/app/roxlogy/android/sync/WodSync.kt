package app.roxlogy.android.sync

import android.content.Context
import app.roxlogy.shared.sync.WearPaths
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 오늘의 WOD 를 Data Layer 로 워치에 푸시 (GoalSync 패턴).
 * 워치는 토큰이 없으므로 폰이 조회해 밀어주고, 워치는 플레이어로 수행만 한다.
 * done 배열은 LongArray(0/1) — DataMap 에 boolean 배열 타입이 없음.
 */
class WodSync(private val wod: WodClient = WodClient()) {

    suspend fun fetchAndPush(context: Context): Boolean = withContext(Dispatchers.IO) {
        val access = TokenStore.accessToken() ?: return@withContext false
        var today = wod.loadToday(access)
        if (today == null) {
            val fresh = AuthClient().refreshAccessToken()
            if (fresh != null) today = wod.loadToday(fresh)
        }
        val w = today ?: return@withContext false

        val req = PutDataMapRequest.create(WearPaths.WOD_PATH)
        val m = req.dataMap
        m.putString("title", w.title)
        m.putInt("day", w.dayNumber)
        m.putStringArray("ids", w.items.map { it.itemId }.toTypedArray())
        m.putStringArray("names", w.items.map { it.name }.toTypedArray())
        m.putStringArray("notes", w.items.map { it.targetNote ?: "" }.toTypedArray())
        m.putLongArray("done", w.items.map { if (it.done) 1L else 0L }.toLongArray())
        m.putLong("ts", System.currentTimeMillis())

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
}
