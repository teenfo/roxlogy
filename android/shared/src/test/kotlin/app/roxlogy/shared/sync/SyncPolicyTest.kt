package app.roxlogy.shared.sync

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SyncPolicyTest {

    // ---- UploadRetry ----

    @Test
    fun `network error and 5xx back off exponentially up to max`() {
        assertEquals(RetryDecision.Retry(2_000L), UploadRetry.decide(null, 1))
        assertEquals(RetryDecision.Retry(4_000L), UploadRetry.decide(500, 2))
        assertEquals(RetryDecision.Retry(8_000L), UploadRetry.decide(503, 3))
        assertEquals(RetryDecision.Retry(16_000L), UploadRetry.decide(null, 4))
        assertEquals(RetryDecision.GiveUp, UploadRetry.decide(500, 5)) // 최대 초과
    }

    @Test
    fun `4xx does not retry except 401`() {
        assertEquals(RetryDecision.GiveUp, UploadRetry.decide(400, 1))
        assertEquals(RetryDecision.GiveUp, UploadRetry.decide(413, 1))
        assertEquals(RetryDecision.GiveUp, UploadRetry.decide(405, 1))
        assertEquals(RetryDecision.RefreshAuthThenRetry, UploadRetry.decide(401, 1))
        assertEquals(RetryDecision.GiveUp, UploadRetry.decide(401, 1, authAlreadyRetried = true))
    }

    @Test
    fun `success helper`() {
        assertTrue(UploadRetry.isSuccess(200))
        assertFalse(UploadRetry.isSuccess(500))
    }

    // ---- RetentionPolicy ----

    private val hour = 3_600_000L

    @Test
    fun `prunes by age and count but never unsynced`() {
        val now = 1_000L * hour
        val sessions = buildList {
            // 25 synced within age → count limit prunes oldest 5
            for (i in 0 until 25) add(LocalSessionMeta("s$i", now - i * hour, synced = true))
            // one very old synced (over 72h) → pruned by age
            add(LocalSessionMeta("old", now - 100 * hour, synced = true))
            // one very old UNSYNCED → must be kept
            add(LocalSessionMeta("keepme", now - 100 * hour, synced = false))
        }
        val prune = RetentionPolicy.toPrune(sessions, now).toSet()

        assertTrue("old" in prune)            // 나이 초과
        assertFalse("keepme" in prune)        // 미동기 보존
        assertFalse("s0" in prune)            // 최신은 보존
        // 최신 20개 초과분(s20..s24) 프루닝
        assertTrue("s20" in prune)
        assertTrue("s24" in prune)
        assertFalse("s19" in prune)
    }
}
