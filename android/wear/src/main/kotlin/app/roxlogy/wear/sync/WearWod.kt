package app.roxlogy.wear.sync

import android.content.Context
import app.roxlogy.shared.sync.WearPaths
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 폰(WodSync)이 밀어넣은 오늘의 WOD 를 워치에서 복원. 워치는 플레이어 — 수행·체크만.
 */
object WearWod {

    data class Item(val id: String, val name: String, val note: String?, val done: Boolean)
    data class Wod(val title: String, val day: Int, val items: List<Item>)

    suspend fun load(context: Context): Wod? = withContext(Dispatchers.IO) {
        try {
            val client = Wearable.getDataClient(context)
            val buffer = Tasks.await(client.getDataItems())
            var result: Wod? = null
            for (item in buffer) {
                if (item.uri.path == WearPaths.WOD_PATH) {
                    val m = DataMapItem.fromDataItem(item).dataMap
                    val ids = m.getStringArray("ids") ?: arrayOf()
                    val names = m.getStringArray("names") ?: arrayOf()
                    val notes = m.getStringArray("notes") ?: arrayOf()
                    val done = m.getLongArray("done") ?: longArrayOf()
                    val n = minOf(ids.size, names.size)
                    result = Wod(
                        title = m.getString("title") ?: "오늘의 WOD",
                        day = m.getInt("day", 0),
                        items = (0 until n).map { i ->
                            Item(
                                id = ids[i],
                                name = names[i],
                                note = notes.getOrNull(i)?.takeIf { it.isNotBlank() },
                                done = done.getOrNull(i) == 1L,
                            )
                        },
                    )
                }
            }
            buffer.release()
            result
        } catch (_: Exception) {
            null
        }
    }
}
