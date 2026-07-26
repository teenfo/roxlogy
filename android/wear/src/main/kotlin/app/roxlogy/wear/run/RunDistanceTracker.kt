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

    /** 최신 심박 bpm (BODY_SENSORS 허용 + 기기 지원 시, 아니면 0). */
    @Volatile
    var heartRateBpm: Double = 0.0
        private set

    @Volatile
    var active: Boolean = false
        private set

    private var callback: ExerciseUpdateCallback? = null

    /** RUNNING_TREADMILL + DISTANCE_TOTAL 지원 시 운동 시작. 성공하면 true.
     *  HEART_RATE_BPM은 지원 기기에서만 함께 구독(세그먼트 평균/최대 집계용). */
    suspend fun start(): Boolean {
        return try {
            val caps = client.getCapabilitiesAsync().await()
            val t = caps.getExerciseTypeCapabilities(ExerciseType.RUNNING_TREADMILL)
            if (!t.supportedDataTypes.contains(DataType.DISTANCE_TOTAL)) return false
            val withHr = t.supportedDataTypes.contains(DataType.HEART_RATE_BPM)

            val cb = object : ExerciseUpdateCallback {
                override fun onRegistered() {}
                override fun onRegistrationFailed(throwable: Throwable) {}
                override fun onExerciseUpdateReceived(update: ExerciseUpdate) {
                    val d = update.latestMetrics.getData(DataType.DISTANCE_TOTAL)
                    if (d != null) distanceMeters = d.total
                    val hr = update.latestMetrics.getData(DataType.HEART_RATE_BPM)
                    hr?.lastOrNull()?.let { heartRateBpm = it.value }
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
                .setDataTypes(
                    if (withHr) setOf(DataType.DISTANCE_TOTAL, DataType.HEART_RATE_BPM)
                    else setOf(DataType.DISTANCE_TOTAL),
                )
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
