package app.roxlogy.android.sync

import android.content.Context
import app.roxlogy.shared.sync.WearPaths
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 보류된 워치 세션 회수.
 *
 * PhoneDataReceiver 는 DataItem 이 도착한 그 순간에만 처리하는데, 그때 로그인 전이면
 * 세션을 건너뛴다. DataItem 내용은 그대로라 onDataChanged 가 다시 오지 않으므로
 * 그 세션은 사용자가 워치 보관함에서 수동 재전송하기 전까지 영영 올라가지 않는다.
 *
 * 그래서 로그인 직후·앱 진입 시 Data Layer 에 남아 있는 세션 아이템을 훑어 업로드한다.
 * 서버 업서트가 멱등(sessions.id + client_updated_at 가드)이라 중복 업로드는 안전하다.
 */
class PendingSessionSync(
    private val uploader: IngestUploader = IngestUploader(),
    private val auth: AuthClient = AuthClient(),
) {

    /** 업로드에 성공한 세션 수. 로그인 전이면 0. */
    suspend fun uploadPending(context: Context): Int = withContext(Dispatchers.IO) {
        val token = TokenStore.accessToken() ?: return@withContext 0
        val buffer = try {
            Tasks.await(Wearable.getDataClient(context).getDataItems())
        } catch (_: Exception) {
            return@withContext 0
        }
        val payloads = mutableListOf<String>()
        try {
            for (item in buffer) {
                val path = item.uri.path ?: continue
                if (!path.startsWith(WearPaths.SESSION_PATH_PREFIX)) continue
                DataMapItem.fromDataItem(item).dataMap
                    .getByteArray(WearPaths.KEY_PAYLOAD)
                    ?.decodeToString()
                    ?.let { payloads.add(it) }
            }
        } finally {
            buffer.release()
        }

        var ok = 0
        for (json in payloads) {
            val sent = uploader.upload(
                json = json,
                initialToken = token,
                tokenRefresh = { auth.refreshAccessToken() },
            )
            if (sent) ok++
        }
        ok
    }
}
