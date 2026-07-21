package app.roxlogy.android.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import app.roxlogy.android.MainActivity
import app.roxlogy.android.R
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * FCM 수신 — 포그라운드 메시지를 알림으로 표시하고, 토큰 갱신 시 서버에 재등록.
 * (앱이 백그라운드일 때 notification 메시지는 시스템 트레이가 매니페스트 메타의 채널·색으로 자동 표시.)
 */
class RoxMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        PushRegistration.uploadToken(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val title = message.notification?.title ?: data["title"] ?: "Roxlogy"
        val body = message.notification?.body ?: data["body"] ?: ""
        val url = data["url"] ?: "/dashboard"
        show(this, title, body, url)
    }

    companion object {
        const val CHANNEL_ID = "rox_push"
        const val EXTRA_URL = "rox_url"

        fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val mgr = context.getSystemService(NotificationManager::class.java) ?: return
            if (mgr.getNotificationChannel(CHANNEL_ID) != null) return
            mgr.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "Roxlogy 알림",
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply { description = "WOD 리마인더·팔로워 등 앱 알림" },
            )
        }

        fun show(context: Context, title: String, body: String, url: String) {
            ensureChannel(context)
            val intent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra(EXTRA_URL, url)
            }
            val pending = PendingIntent.getActivity(
                context,
                url.hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val notif = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setContentIntent(pending)
                .build()
            if (NotificationManagerCompat.from(context).areNotificationsEnabled()) {
                NotificationManagerCompat.from(context).notify(url.hashCode(), notif)
            }
        }
    }
}
