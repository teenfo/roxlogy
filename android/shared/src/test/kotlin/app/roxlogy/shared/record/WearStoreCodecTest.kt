package app.roxlogy.shared.record

import app.roxlogy.shared.sim.SimEngine
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class WearStoreCodecTest {

    @Test
    fun `snapshot roundtrip and engine restore`() {
        val engine = SimEngine()
        engine.record(300_000) // run1
        engine.record(8_000)   // roxzone
        engine.record(267_000) // ski
        val snap = SimSnapshot(
            startIso = "2026-07-26T10:00:00Z",
            slotStartEpochMs = 1_000_000L,
            segments = WearStoreCodec.fromRecorded(engine.recordedSegments()),
        )
        val decoded = WearStoreCodec.decodeSnapshot(WearStoreCodec.encodeSnapshot(snap))!!
        assertEquals(snap, decoded)

        val restored = SimEngine()
        restored.restore(WearStoreCodec.toRecorded(decoded))
        assertEquals(3, restored.index)
        assertEquals("station", restored.recordedSegments()[2].kind)
        assertEquals(575_000L, restored.elapsedTotalMs())
    }

    @Test
    fun `undo reverts last lap and index`() {
        val engine = SimEngine()
        engine.record(300_000)
        engine.record(8_000)
        assertEquals(2, engine.index)
        assertEquals(8_000L, engine.undoLast())
        assertEquals(1, engine.index)
        assertEquals("roxzone", engine.current?.kind)
        val empty = SimEngine()
        assertNull(empty.undoLast())
        assertEquals(0, empty.index)
    }

    @Test
    fun `prune keeps newest 20 within 72h`() {
        val now = 1_000_000_000_000L
        val hour = 3600_000L
        val list = (0 until 25).map {
            StoredSession(
                id = "s$it", createdAtMs = now - it * hour, totalMs = 1,
                clientUpdatedAt = "t", payloadJson = "{}",
            )
        } + StoredSession("old", now - 80 * hour, 1, "t", "{}")
        val pruned = WearStoreCodec.prune(list, now)
        assertEquals(20, pruned.size)
        assertEquals("s0", pruned.first().id)
        assertTrue(pruned.none { it.id == "old" })
        assertTrue(pruned.all { now - it.createdAtMs <= WearStoreCodec.MAX_AGE_MS })
    }
}
