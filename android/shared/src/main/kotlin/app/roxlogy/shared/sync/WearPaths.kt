package app.roxlogy.shared.sync

/** Wearable Data Layer 경로/키 — 워치 송신과 폰 수신이 공유. */
object WearPaths {
    const val SESSION_PATH_PREFIX = "/roxlogy/session/"
    const val KEY_PAYLOAD = "payload"
    const val KEY_UPDATED = "client_updated_at"

    // 오늘의 WOD: 폰 → 워치 푸시 / 워치 → 폰 완료 역동기화
    const val WOD_PATH = "/roxlogy/wod"
    const val WOD_DONE_PREFIX = "/roxlogy/wod-done/"
    const val KEY_WOD_ELAPSED_MS = "elapsed_ms"
}
