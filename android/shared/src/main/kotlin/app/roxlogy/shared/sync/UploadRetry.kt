package app.roxlogy.shared.sync

/**
 * ingest-session 업로드 재시도 정책 (docs/API_CONTRACT.md).
 * - 네트워크 오류·5xx: 지수 백오프(2·4·8·16·32초) 최대 5회
 * - 4xx: 재시도 안 함 (페이로드/상태 문제) — 단 401은 토큰 갱신 후 1회
 * 멱등 계약이라 중복 전송은 안전.
 */
sealed interface RetryDecision {
    /** delayMs 만큼 대기 후 재시도 */
    data class Retry(val delayMs: Long) : RetryDecision
    /** 401 — 토큰 갱신 후 1회 재시도 */
    data object RefreshAuthThenRetry : RetryDecision
    /** 재시도 불가 (4xx 또는 최대 시도 초과) */
    data object GiveUp : RetryDecision
}

object UploadRetry {
    const val MAX_ATTEMPTS = 5
    const val BASE_DELAY_MS = 2_000L

    /**
     * @param status HTTP 상태코드, 네트워크 오류면 null
     * @param attempt 방금 실패한 시도 회차 (1부터)
     * @param authAlreadyRetried 401 재시도를 이미 한 번 했는지
     */
    fun decide(status: Int?, attempt: Int, authAlreadyRetried: Boolean = false): RetryDecision {
        if (status == 401) {
            return if (authAlreadyRetried) RetryDecision.GiveUp
            else RetryDecision.RefreshAuthThenRetry
        }
        // 그 외 4xx: 재시도 무의미 (400/405/413 등)
        if (status != null && status in 400..499) return RetryDecision.GiveUp

        // 네트워크 오류(null) 또는 5xx: 백오프
        if (attempt >= MAX_ATTEMPTS) return RetryDecision.GiveUp
        val delay = BASE_DELAY_MS shl (attempt - 1) // 2s,4s,8s,16s
        return RetryDecision.Retry(delay)
    }

    /** 2xx 판정 헬퍼. */
    fun isSuccess(status: Int): Boolean = status in 200..299
}
