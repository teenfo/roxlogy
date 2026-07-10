package app.roxlogy.wear.sync

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import app.roxlogy.shared.sim.GoalPlan
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 폰이 Data Layer로 밀어넣은 목표(goal_plans)를 워치에서 읽어 GoalPlan으로 복원.
 * 워치는 인증 토큰이 없으므로 목표 조회는 폰(GoalSync)이 담당 → 여기서는 수신만.
 */
object WearGoal {
    const val PATH = "/roxlogy/goal"

    suspend fun load(context: Context): GoalPlan? = withContext(Dispatchers.IO) {
        try {
            val client = Wearable.getDataClient(context)
            val buffer = Tasks.await(client.getDataItems())
            var result: GoalPlan? = null
            for (item in buffer) {
                if (item.uri.path == PATH) {
                    val map = DataMapItem.fromDataItem(item).dataMap
                    val keys = map.getStringArray("stKeys") ?: arrayOf()
                    val vals = map.getLongArray("stVals") ?: longArrayOf()
                    val targets = HashMap<String, Long>()
                    val n = minOf(keys.size, vals.size)
                    for (i in 0 until n) targets[keys[i]] = vals[i]
                    result = GoalPlan(
                        targetTotalMs = map.getLong("target"),
                        runTotalMs = map.getLong("run"),
                        stationTotalMs = map.getLong("station"),
                        roxzoneTotalMs = map.getLong("roxzone"),
                        stationTargets = targets,
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
