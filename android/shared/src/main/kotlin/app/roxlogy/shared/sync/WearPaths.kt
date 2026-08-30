package app.roxlogy.shared.sync

/** Wearable Data Layer 경로/키 — 워치 송신과 폰 수신이 공유. */
object WearPaths {
    const val SESSION_PATH_PREFIX = "/roxlogy/session/"
    const val KEY_PAYLOAD = "payload"

    /** 큰 페이로드용 Asset 키. DataItem 본문은 약 100KB 로 제한되어 있어
     *  1Hz 샘플·스트로크·힘곡선이 붙는 긴 에르그 세션은 그대로 실으면 put 이
     *  실패한다. 임계값을 넘으면 payload 대신 이 Asset 으로 보낸다. */
    const val KEY_PAYLOAD_ASSET = "payload_asset"

    /** DataItem 본문에 인라인으로 담을 수 있는 최대 바이트 (안전 여유 포함). */
    const val MAX_INLINE_PAYLOAD_BYTES = 60_000

    const val KEY_UPDATED = "client_updated_at"

    // 오늘의 WOD: 폰 → 워치 푸시 / 워치 → 폰 완료 역동기화
    const val WOD_PATH = "/roxlogy/wod"
    const val WOD_DONE_PREFIX = "/roxlogy/wod-done/"
    const val KEY_WOD_ELAPSED_MS = "elapsed_ms"
}
