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
        sendRaw(request.session.id, IngestJson.encode(request), request.session.client_updated_at)
    }

    /** WOD 항목 완료 역동기화 — 폰(PhoneDataReceiver)이 completion 을 서버에 기록. */
    fun sendWodDone(itemId: String, elapsedMs: Long) {
        val put = PutDataMapRequest.create("${WearPaths.WOD_DONE_PREFIX}$itemId").apply {
            dataMap.putLong(WearPaths.KEY_WOD_ELAPSED_MS, elapsedMs)
            dataMap.putLong("ts", System.currentTimeMillis())
        }.asPutDataRequest().setUrgent()
        dataClient.putDataItem(put)
    }

    /** 보관함 재전송용 — 저장된 인코딩 원문을 그대로 다시 밀어넣는다.
     *  resent_at 으로 DataItem 내용을 바꿔, 동일 페이로드도 재동기화되게 강제. */
    fun sendRaw(sessionId: String, payloadJson: String, clientUpdatedAt: String) {
        val put = PutDataMapRequest.create(
            "${WearPaths.SESSION_PATH_PREFIX}$sessionId",
        ).apply {
            dataMap.putByteArray(WearPaths.KEY_PAYLOAD, payloadJson.encodeToByteArray())
            dataMap.putString(WearPaths.KEY_UPDATED, clientUpdatedAt)
            dataMap.putLong("resent_at", System.currentTimeMillis())
        }.asPutDataRequest().setUrgent()
        dataClient.putDataItem(put)
    }
}
