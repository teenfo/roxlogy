import { RUN_EXERCISE_ID, STATIONS } from "./hyrox";

/**
 * 수동 입력 폼 상태 → sessions/session_segments 행 변환.
 * 워치/폰 클라이언트와 동일한 계약: 세션·세그먼트 id는 클라이언트 UUID,
 * 충돌 키는 sessions(id)/session_segments(session_id, seq),
 * LWW 기준은 client_updated_at.
 */

export type SegmentForm = {
  kind: "run" | "station" | "roxzone";
  /** 스테이션이면 hyrox.ts key (표시 문자열은 화면에서 로케일에 맞게 결정) */
  stationKey: string | null;
  /** run/roxzone 라벨 번호 (1~8) */
  n: number;
  exerciseId: string | null;
  machineType: "ski" | "row" | null;
  splitMs: number | null; // 폼 입력값 (null = 미입력)
};

/** 레이스 시뮬 기본 골격: (런 → 록스존 → 스테이션) × 8 = 24 세그먼트 */
export function raceSimTemplate(): SegmentForm[] {
  return STATIONS.flatMap((station, i) => [
    {
      kind: "run" as const,
      stationKey: null,
      n: i + 1,
      exerciseId: RUN_EXERCISE_ID,
      machineType: null,
      splitMs: null,
    },
    {
      kind: "roxzone" as const,
      stationKey: null,
      n: i + 1,
      exerciseId: null,
      machineType: null,
      splitMs: null,
    },
    {
      kind: "station" as const,
      stationKey: station.key,
      n: i + 1,
      exerciseId: station.exerciseId,
      machineType: station.machineType,
      splitMs: null,
    },
  ]);
}

/** 저장된 레이스 결과의 splits(JSONB) → 레이스 시뮬 24행 폼으로 채움 */
export type RaceSplits = {
  stations?: Record<string, number>;
  run_total_ms?: number;
  runs?: number[];
  roxzones?: number[];
};

export function raceSplitsToForms(splits: RaceSplits): SegmentForm[] {
  return raceSimTemplate().map((f) => {
    if (f.kind === "run")
      return { ...f, splitMs: splits.runs?.[f.n - 1] ?? null };
    if (f.kind === "roxzone")
      return { ...f, splitMs: splits.roxzones?.[f.n - 1] ?? null };
    return { ...f, splitMs: splits.stations?.[f.stationKey!] ?? null };
  });
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
    notes: string | null;
    rpe: number | null;
    template_id: string | null;
    division: string | null;
    race_result_id: string | null;
    leaderboard_excluded: boolean;
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
  opts?: {
    /** 수정 모드: 기존 세션 id 재사용 (충돌 키 sessions(id)로 업서트) */
    sessionId?: string;
    /** 수정 모드: seq 순서대로 재사용할 기존 세그먼트 id */
    segmentIds?: string[];
    /** 주관적 훈련 로그 (선택) */
    notes?: string | null;
    rpe?: number | null;
    /** 프로그램 워크아웃 연결 (선택) */
    templateId?: string | null;
    /** 디비전 (선택) */
    division?: string | null;
    /** 레이스 결과 연동 (레이스→세션 변환 시) */
    raceResultId?: string | null;
    /** 리더보드 노출 제외 (세션별) */
    leaderboardExcluded?: boolean;
  },
): SessionRows | { error: string } {
  const filled = segments.filter((s) => s.splitMs != null && s.splitMs > 0);
  if (!filled.length) return { error: "empty" as const };

  const sessionId = opts?.sessionId ?? crypto.randomUUID();
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
      notes: opts?.notes?.trim() ? opts.notes.trim() : null,
      rpe: opts?.rpe ?? null,
      template_id: opts?.templateId ?? null,
      division: opts?.division ?? null,
      race_result_id: opts?.raceResultId ?? null,
      leaderboard_excluded: opts?.leaderboardExcluded ?? false,
    },
    segments: filled.map((s, idx) => ({
      // 같은 seq 자리의 기존 id를 재사용해야 erg_samples 참조가 유지되고
      // (session_id, seq) 충돌 업데이트가 PK 변경을 시도하지 않는다
      id: opts?.segmentIds?.[idx] ?? crypto.randomUUID(),
      session_id: sessionId,
      seq: idx + 1,
      kind: s.kind,
      exercise_id: s.exerciseId,
      machine_type: s.machineType,
      split_time_ms: s.splitMs!,
    })),
  };
}
