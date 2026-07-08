package app.roxlogy.wear.sync

import android.content.Context
import app.roxlogy.shared.ingest.IngestJson
import app.roxlogy.shared.ingest.IngestRequest
import app.roxlogy.shared.sync.WearPaths
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable

/**
 * 완결된 세션을 Wearable Data Layer로 폰에 전달. 폰이 `ingest-session`에 업로드한다.
 * DataItem은 내용 기준 dedupe되므로 client_updated_at 변경 시에만 재전송 → 멱등과 정합.
 */
class WearDataSender(context: Context) {

    private val dataClient = Wearable.getDataClient(context)

    fun sendSession(request: IngestRequest) {
        val json = IngestJson.encode(request)
        val put = PutDataMapRequest.create(
            "${WearPaths.SESSION_PATH_PREFIX}${request.session.id}",
        ).apply {
            dataMap.putByteArray(WearPaths.KEY_PAYLOAD, json.encodeToByteArray())
            dataMap.putString(WearPaths.KEY_UPDATED, request.session.client_updated_at)
        }.asPutDataRequest().setUrgent()
        dataClient.putDataItem(put)
    }
}
