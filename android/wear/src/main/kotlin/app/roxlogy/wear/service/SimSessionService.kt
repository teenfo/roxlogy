package app.roxlogy.wear.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status
import app.roxlogy.wear.MainActivity
import app.roxlogy.wear.R

/**
 * 시뮬 진행 중 포그라운드 서비스 + Ongoing Activity.
 * 화면이 꺼졌다 켜져도 앱이 백그라운드로 밀리지 않고, 갤럭시 타이머/헬스 앱처럼
 * 워치페이스 하단 아이콘·최근 앱에 "진행 중"으로 표시돼 원탭으로 복귀할 수 있다.
 */
class SimSessionService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
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
            .setContentTitle("하이록스 시뮬 진행 중")
            .setContentIntent(touch)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)

        OngoingActivity.Builder(applicationContext, NOTIF_ID, builder)
            .setStaticIcon(R.drawable.ic_stat_sim)
            .setTouchIntent(touch)
            .setStatus(Status.Builder().addTemplate("시뮬 진행 중").build())
            .build()
            .apply(applicationContext)

        startForeground(NOTIF_ID, builder.build())
        return START_STICKY
    }

    companion object {
        private const val CHANNEL = "sim_session"
        private const val NOTIF_ID = 100

        fun start(context: Context) =
            context.startForegroundService(Intent(context, SimSessionService::class.java))

        fun stop(context: Context) =
            context.stopService(Intent(context, SimSessionService::class.java))
    }
}
