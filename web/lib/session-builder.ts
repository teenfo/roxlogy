import { RUN_EXERCISE_ID, STATIONS } from "./hyrox";

/**
 * 수동 입력 폼 상태 → sessions/session_segments 행 변환.
 * 워치/폰 클라이언트와 동일한 계약: 세션·세그먼트 id는 클라이언트 UUID,
 * 충돌 키는 sessions(id)/session_segments(session_id, seq),
 * LWW 기준은 client_updated_at.
 */

export type SegmentForm = {
  kind: "run" | "station" | "roxzone";
  label: string;
  exerciseId: string | null;
  machineType: "ski" | "row" | null;
  splitMs: number | null; // 폼 입력값 (null = 미입력)
};

/** 레이스 시뮬 기본 골격: (런 → 록스존 → 스테이션) × 8 = 24 세그먼트 */
export function raceSimTemplate(): SegmentForm[] {
  return STATIONS.flatMap((station, i) => [
    {
      kind: "run" as const,
      label: `런 ${i + 1} (1km)`,
      exerciseId: RUN_EXERCISE_ID,
      machineType: null,
      splitMs: null,
    },
    {
      kind: "roxzone" as const,
      label: `록스존 ${i + 1}`,
      exerciseId: null,
      machineType: null,
      splitMs: null,
    },
    {
      kind: "station" as const,
      label: station.nameKo,
      exerciseId: station.exerciseId,
      machineType: station.machineType,
      splitMs: null,
    },
  ]);
}

export type SessionRows = {
  session: {
    id: string;
    user_id: string;
    source_device: "web";
    sync_status: "synced";
    started_at: string;
    ended_at: string;
    total_time_ms: number;
    client_updated_at: string;
  };
  segments: {
    id: string;
    session_id: string;
    seq: number;
    kind: string;
    exercise_id: string | null;
    machine_type: string | null;
    split_time_ms: number;
  }[];
};

export function buildSessionRows(
  userId: string,
  startedAtIso: string,
  segments: SegmentForm[],
): SessionRows | { error: string } {
  const filled = segments.filter((s) => s.splitMs != null && s.splitMs > 0);
  if (!filled.length) return { error: "기록을 1개 이상 입력해 주세요." };

  const sessionId = crypto.randomUUID();
  const totalMs = filled.reduce((acc, s) => acc + (s.splitMs ?? 0), 0);
  const started = new Date(startedAtIso);
  const nowIso = new Date().toISOString();

  return {
    session: {
      id: sessionId,
      user_id: userId,
      source_device: "web",
      sync_status: "synced",
      started_at: started.toISOString(),
      ended_at: new Date(started.getTime() + totalMs).toISOString(),
      total_time_ms: totalMs,
      client_updated_at: nowIso,
    },
    segments: filled.map((s, idx) => ({
      id: crypto.randomUUID(),
      session_id: sessionId,
      seq: idx + 1,
      kind: s.kind,
      exercise_id: s.exerciseId,
      machine_type: s.machineType,
      split_time_ms: s.splitMs!,
    })),
  };
}
