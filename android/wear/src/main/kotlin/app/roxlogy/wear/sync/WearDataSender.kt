package app.roxlogy.wear.sync

import android.content.Context
import app.roxlogy.shared.ingest.IngestJson
import app.roxlogy.shared.ingest.IngestRequest
import app.roxlogy.shared.sync.WearPaths
import app.roxlogy.wear.store.WearStore
import com.google.android.gms.wearable.Asset
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable

/**
 * 완결된 세션을 Wearable Data Layer로 폰에 전달. 폰이 `ingest-session`에 업로드한다.
 * DataItem은 내용 기준 dedupe되므로 client_updated_at 변경 시에만 재전송 → 멱등과 정합.
 *
 * 전달 결과를 보관함의 sent 플래그에 반영한다. 예전에는 put 결과를 버리고
 * 무조건 sent=true 로 저장해, 전송이 조용히 실패해도 화면은 "전송됨"으로 보이고
 * 72시간 뒤 프루닝으로 세션이 사라졌다.
 */
class WearDataSender(context: Context) {

    private val appContext = context.applicationContext
    private val dataClient = Wearable.getDataClient(appContext)

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
        val bytes = payloadJson.encodeToByteArray()
        val put = PutDataMapRequest.create(
            "${WearPaths.SESSION_PATH_PREFIX}$sessionId",
        ).apply {
            // DataItem 본문 한도(약 100KB)를 넘는 긴 에르그 세션은 Asset 으로 보낸다.
            // 인라인으로 실으면 putDataItem 자체가 실패해 세션이 통째로 유실된다.
            if (bytes.size > WearPaths.MAX_INLINE_PAYLOAD_BYTES) {
                dataMap.putAsset(WearPaths.KEY_PAYLOAD_ASSET, Asset.createFromBytes(bytes))
            } else {
                dataMap.putByteArray(WearPaths.KEY_PAYLOAD, bytes)
            }
            dataMap.putString(WearPaths.KEY_UPDATED, clientUpdatedAt)
            dataMap.putLong("resent_at", System.currentTimeMillis())
        }.asPutDataRequest().setUrgent()

        dataClient.putDataItem(put)
            .addOnSuccessListener { WearStore.markSent(appContext, sessionId, true) }
            .addOnFailureListener { WearStore.markSent(appContext, sessionId, false) }
    }
}
