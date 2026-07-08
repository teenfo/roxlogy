package app.roxlogy.shared.sync

/** 워치 로컬 세션 메타 (프루닝 판정용). */
data class LocalSessionMeta(
    val id: String,
    val startedAtMs: Long,
    val synced: Boolean,
)

/**
 * 워치 오프라인 보관 한도 (docs/API_CONTRACT.md):
 * **최근 20세션 또는 72시간** 중 먼저 도달하는 쪽. 미동기(synced=false) 세션은 절대 삭제 금지.
 */
object RetentionPolicy {
    const val KEEP_COUNT = 20
    const val MAX_AGE_MS = 72L * 60 * 60 * 1000 // 72h

    /** 삭제 대상 세션 id 목록 반환. */
    fun toPrune(
        sessions: List<LocalSessionMeta>,
        nowMs: Long,
        keepCount: Int = KEEP_COUNT,
        maxAgeMs: Long = MAX_AGE_MS,
    ): List<String> {
        val prune = LinkedHashSet<String>()
        val synced = sessions.filter { it.synced }
        val newestFirst = synced.sortedByDescending { it.startedAtMs }

        // 나이 초과
        for (s in newestFirst) {
            if (nowMs - s.startedAtMs > maxAgeMs) prune.add(s.id)
        }
        // 개수 초과 (최신 keepCount만 보존)
        newestFirst.drop(keepCount).forEach { prune.add(it.id) }

        return prune.toList()
    }
}
