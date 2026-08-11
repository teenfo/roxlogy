package app.roxlogy.wear.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status
import app.roxlogy.wear.MainActivity
import app.roxlogy.wear.R

/**
 * 시뮬 진행 중 포그라운드 서비스 + Ongoing Activity.
 * 화면이 꺼졌다 켜져도 앱이 백그라운드로 밀리지 않고, 갤럭시 타이머/헬스 앱처럼
 * 워치페이스 하단 아이콘·최근 앱에 "진행 중"으로 표시돼 원탭으로 복귀할 수 있다.
 * 타이머 앱처럼 현재 동작의 경과 시간을 워치페이스 칩에 실시간 표시한다 —
 * 호출자가 라벨("RUN 1"·"스키에르그" 등)과 시작 시각을 넘기면 스톱워치로 흐른다.
 */
class SimSessionService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val label = intent?.getStringExtra(EXTRA_LABEL) ?: "시뮬 진행 중"
        val startedAtMs = intent?.getLongExtra(EXTRA_STARTED_AT, 0L) ?: 0L

        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "시뮬 진행", NotificationManager.IMPORTANCE_LOW),
        )
        val touch = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val builder = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_sim)
            .setContentTitle(label)
            .setContentIntent(touch)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)
        if (startedAtMs > 0L) {
            builder.setWhen(startedAtMs).setUsesChronometer(true)
        }

        // OngoingActivity 스톱워치는 elapsedRealtime 타임베이스 — wall clock 시작 시각을 변환
        val status = if (startedAtMs > 0L) {
            val base = SystemClock.elapsedRealtime() - (System.currentTimeMillis() - startedAtMs)
            Status.Builder()
                .addTemplate("$label #elapsed#")
                .addPart("elapsed", Status.StopwatchPart(base))
                .build()
        } else {
            Status.Builder().addTemplate(label).build()
        }

        OngoingActivity.Builder(applicationContext, NOTIF_ID, builder)
            .setStaticIcon(R.drawable.ic_stat_sim)
            .setTouchIntent(touch)
            .setStatus(status)
            .build()
            .apply(applicationContext)

        startForeground(NOTIF_ID, builder.build())
        return START_STICKY
    }

    companion object {
        private const val CHANNEL = "sim_session"
        private const val NOTIF_ID = 100
        private const val EXTRA_LABEL = "label"
        private const val EXTRA_STARTED_AT = "started_at"

        /** label: 워치페이스 칩·알림에 표시할 현재 동작. startedAtMs(wall clock): 0 이면 시간 없이 라벨만. */
        fun start(context: Context, label: String? = null, startedAtMs: Long = 0L) =
            context.startForegroundService(
                Intent(context, SimSessionService::class.java).apply {
                    label?.let { putExtra(EXTRA_LABEL, it) }
                    putExtra(EXTRA_STARTED_AT, startedAtMs)
                },
            )

        fun stop(context: Context) =
            context.stopService(Intent(context, SimSessionService::class.java))
    }
}
