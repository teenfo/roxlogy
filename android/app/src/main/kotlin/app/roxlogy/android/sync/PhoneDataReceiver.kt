package app.roxlogy.android.sync

import app.roxlogy.shared.sync.WearPaths
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.Asset
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
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
    private val auth = AuthClient()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val wodClient = WodClient()

    override fun onDataChanged(events: DataEventBuffer) {
        for (event in events) {
            if (event.type != DataEvent.TYPE_CHANGED) continue
            val item = event.dataItem
            val path = item.uri.path ?: continue

            when {
                path.startsWith(WearPaths.SESSION_PATH_PREFIX) -> {
                    val map = DataMapItem.fromDataItem(item).dataMap
                    // 인라인 payload 또는 (DataItem 한도를 넘는 긴 에르그 세션의) Asset
                    val inline = map.getByteArray(WearPaths.KEY_PAYLOAD)?.decodeToString()
                    val asset = map.getAsset(WearPaths.KEY_PAYLOAD_ASSET)
                    if (inline == null && asset == null) continue
                    val token = TokenStore.accessToken() ?: continue // 로그인 전이면 보류
                    scope.launch {
                        val json = inline ?: readAsset(asset!!) ?: return@launch
                        uploader.upload(
                            json = json,
                            initialToken = token,
                            tokenRefresh = { auth.refreshAccessToken() },
                        )
                    }
                }
                // 워치 WOD 완료 역동기화 — 소요시간은 note "⌚ m:ss" 로 저장 (스키마 무변경)
                path.startsWith(WearPaths.WOD_DONE_PREFIX) -> {
                    val itemId = path.removePrefix(WearPaths.WOD_DONE_PREFIX)
                    if (itemId.isBlank()) continue
                    val map = DataMapItem.fromDataItem(item).dataMap
                    val elapsedMs = map.getLong(WearPaths.KEY_WOD_ELAPSED_MS, 0L)
                    val sec = (elapsedMs / 1000).coerceAtLeast(0)
                    val note = "⌚ %d:%02d".format(sec / 60, sec % 60)
                    scope.launch {
                        var token = TokenStore.accessToken() ?: return@launch
                        var ok = wodClient.saveLog(itemId, null, null, note, token)
                        if (!ok) {
                            token = auth.refreshAccessToken() ?: return@launch
                            ok = wodClient.saveLog(itemId, null, null, note, token)
                        }
                    }
                }
            }
        }
    }

    /** Asset 으로 온 페이로드를 읽어 온다 (블로킹 — IO 디스패처에서 호출할 것). */
    private fun readAsset(asset: Asset): String? = try {
        val fd = Tasks.await(Wearable.getDataClient(this).getFdForAsset(asset))
        fd.inputStream.use { it.readBytes().decodeToString() }
    } catch (_: Exception) {
        null // 실패해도 DataItem 은 남아 다음 진입 때 재처리된다
    }
}
