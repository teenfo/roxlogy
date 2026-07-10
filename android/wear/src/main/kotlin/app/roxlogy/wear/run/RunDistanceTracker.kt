package app.roxlogy.wear.run

import android.content.Context
import androidx.health.services.client.ExerciseUpdateCallback
import androidx.health.services.client.HealthServices
import androidx.health.services.client.data.Availability
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.ExerciseConfig
import androidx.health.services.client.data.ExerciseLapSummary
import androidx.health.services.client.data.ExerciseType
import androidx.health.services.client.data.ExerciseUpdate
import kotlinx.coroutines.guava.await

/**
 * 트레드밀 러닝 실거리 추적 (Health Services, GPS off → 손목 가속도/걸음 기반).
 * 누적 거리(m)를 노출. 지원 안 하면 start()가 false → UI는 수동 랩 폴백을 쓴다.
 * 정확도 ±5~10% (풋팟이면 개선). 실기기 검증 필요.
 */
class RunDistanceTracker(context: Context) {

    private val client = HealthServices.getClient(context).exerciseClient

    @Volatile
    var distanceMeters: Double = 0.0
        private set

    @Volatile
    var active: Boolean = false
        private set

    private var callback: ExerciseUpdateCallback? = null

    /** RUNNING_TREADMILL + DISTANCE_TOTAL 지원 시 운동 시작. 성공하면 true. */
    suspend fun start(): Boolean {
        return try {
            val caps = client.getCapabilitiesAsync().await()
            val t = caps.getExerciseTypeCapabilities(ExerciseType.RUNNING_TREADMILL)
            if (!t.supportedDataTypes.contains(DataType.DISTANCE_TOTAL)) return false

            val cb = object : ExerciseUpdateCallback {
                override fun onRegistered() {}
                override fun onRegistrationFailed(throwable: Throwable) {}
                override fun onExerciseUpdateReceived(update: ExerciseUpdate) {
                    val d = update.latestMetrics.getData(DataType.DISTANCE_TOTAL)
                    if (d != null) distanceMeters = d.total
                }
                override fun onLapSummaryReceived(lapSummary: ExerciseLapSummary) {}
                override fun onAvailabilityChanged(
                    dataType: DataType<*, *>,
                    availability: Availability,
                ) {}
            }
            callback = cb
            client.setUpdateCallback(cb)

            val config = ExerciseConfig.builder(ExerciseType.RUNNING_TREADMILL)
                .setDataTypes(setOf(DataType.DISTANCE_TOTAL))
                .setIsGpsEnabled(false)
                .build()
            client.startExerciseAsync(config).await()
            distanceMeters = 0.0
            active = true
            true
        } catch (_: Exception) {
            active = false
            false
        }
    }

    suspend fun stop() {
        active = false
        try {
            client.endExerciseAsync().await()
        } catch (_: Exception) {
        }
        val cb = callback
        if (cb != null) {
            try {
                client.clearUpdateCallbackAsync(cb).await()
            } catch (_: Exception) {
            }
        }
        callback = null
    }
}
