package app.roxlogy.android.sync

import app.roxlogy.shared.sync.WearPaths
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.WearableListenerService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * 워치 → 폰 세션 수신. Data Layer로 도착한 세션 JSON을 `ingest-session`에 업로드한다.
 * 로그인(TokenStore) 전이면 보류 — Data Layer가 상태를 유지하므로 이후 재처리 가능.
 */
class PhoneDataReceiver : WearableListenerService() {

    private val uploader = IngestUploader()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onDataChanged(events: DataEventBuffer) {
        for (event in events) {
            if (event.type != DataEvent.TYPE_CHANGED) continue
            val item = event.dataItem
            if (item.uri.path?.startsWith(WearPaths.SESSION_PATH_PREFIX) != true) continue

            val map = DataMapItem.fromDataItem(item).dataMap
            val json = map.getByteArray(WearPaths.KEY_PAYLOAD)?.decodeToString() ?: continue
            val token = TokenStore.accessToken() ?: continue // 로그인 전이면 보류

            scope.launch { uploader.upload(json, token) }
        }
    }
}
