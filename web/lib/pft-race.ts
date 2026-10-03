import type { RaceFormat } from "@/lib/race-format";

/** PFT 레이스 보드 — 보드·참가 화면이 공유하는 타입과 순위 계산.
 *  시각 규칙: 스플릿은 참가자 폰이 잰 "시작 이후 누적 ms". 진행 중 경과는 서버 started_at
 *  기준으로 보드 시계(서버 오프셋 보정)가 흐르게 하고, 찍힌 구간은 스플릿 값을 그대로 쓴다. */

export type RaceStatus = "open" | "closed";

export type RaceInfo = {
  id: string;
  code: string;
  title: string;
  status: RaceStatus;
  crew: string | null;
  crew_slug: string | null;
  created_at: string;
  /** 참가 코드로 자가 참가를 허용하는 레이스인지. false 면 운영진이 참가자를 추가한다(코드 비공개). */
  join_open: boolean;
  /** 종목 — 옛 응답(마이그레이션 114 이전)엔 없어서 선택 */
  format?: RaceFormat;
  /** 선수당 구간 수 (pft 6, hyrox_sim 16/24/32) */
  checkpoints?: number;
  /** 레이스 설명(선택, 마이그레이션 132) — 옛 응답엔 없다 */
  description?: string | null;
};

export type RaceEntry = {
  entry_id: string;
  user_id: string;
  name: string;
  started_at: string | null;
  splits: number[];
  finished_at: string | null;
  total_ms: number | null;
  scaled: boolean;
  badge: string | null;
  /** 출발 조. null = 미배정 (마이그레이션 100) */
  wave: number | null;
  /** 중도포기 시각. null = 포기 아님 (마이그레이션 101) */
  dnf_at: string | null;
  /** 일시정지 — 멈춘 시각(멈춰 있을 때만)과 지금까지 멈춰 있던 합(ms) (마이그레이션 124, 옛 응답엔 없다) */
  paused_at?: string | null;
  paused_ms?: number | null;
};

export type BoardData = {
  race: RaceInfo;
  server_now: string;
  entries: RaceEntry[];
  /** 조별 설명 (마이그레이션 126) — 옛 응답에는 없다 */
  waves?: { wave: number; note: string }[];
};

/** 내 엔트리 (pft_race_* RPC 반환) */
export type MyEntry = {
  entry_id: string;
  race_id: string;
  started_at: string | null;
  splits: number[];
  finished_at: string | null;
  total_ms: number | null;
  scaled: boolean;
  result_id: string | null;
  dnf_at: string | null;
  status: RaceStatus;
  /** hyrox_sim 완주로 만든 내 세션 (마이그레이션 114) */
  session_id?: string | null;
  /** 일시정지 (마이그레이션 124) */
  paused_at?: string | null;
  paused_ms?: number | null;
  /** 출발 조 (마이그레이션 125 부터 내려온다 — 옛 응답엔 키가 없어 undefined) */
  wave?: number | null;
};

export type EntryState = "waiting" | "running" | "finished" | "dnf";

/** 조별 묶음 — 배정된 조를 번호순으로, 미배정(null)은 맨 뒤에.
 *  조 안의 순서는 넘겨받은 순서(참가 순서)를 그대로 둔다: 스태프 화면은 카드가 움직이면
 *  누가 어디 있었는지 놓친다(2026-09-12). */
export function groupByWave<T extends { wave: number | null }>(
  rows: T[],
): { wave: number | null; rows: T[] }[] {
  const byWave = new Map<number | null, T[]>();
  for (const r of rows) {
    const k = r.wave ?? null;
    const arr = byWave.get(k);
    if (arr) arr.push(r);
    else byWave.set(k, [r]);
  }
  return [...byWave.entries()]
    .map(([wave, rs]) => ({ wave, rows: rs }))
    .sort((a, b) => {
      if (a.wave === b.wave) return 0;
      if (a.wave === null) return 1;
      if (b.wave === null) return -1;
      return a.wave - b.wave;
    });
}

/** 조가 하나라도 배정돼 있는가 — 배정 전에는 조별 UI 를 띄우지 않는다 */
export function hasWaves(rows: { wave: number | null }[]): boolean {
  return rows.some((r) => r.wave != null);
}

export function entryState(
  e: Pick<RaceEntry, "started_at" | "finished_at"> & { dnf_at?: string | null },
): EntryState {
  if (e.finished_at) return "finished";
  // 중도포기는 출발한 뒤에만 붙는다(서버가 강제). 완주가 먼저다 — 완주했다면 기록이 이긴다.
  if (e.dnf_at) return "dnf";
  if (e.started_at) return "running";
  return "waiting";
}

/** 지금 경과(ms). 완주는 총시간, 진행 중은 보드 시계 기준, 대기는 null.
 *  @param nowMs 보정된 현재 시각(Date.now() + 서버 오프셋) */
export function elapsedOf(e: RaceEntry, nowMs: number): number | null {
  if (e.finished_at) return e.total_ms;
  if (!e.started_at) return null;
  return Math.max(0, nowMs - Date.parse(e.started_at) - pausedMsAt(e, nowMs));
}

/** 그 시각까지 멈춰 있던 시간(ms) = 누적 + (지금 멈춰 있으면 멈춘 뒤 흐른 시간).
 *  경과 = now − started_at − 이 값. 스태프·선수·보드가 모두 이 규칙으로 센다(마이그레이션 124).
 *  @param nowMs 서버 시각 기준(보정된) 현재 */
export function pausedMsAt(
  e: { paused_at?: string | null; paused_ms?: number | null },
  nowMs: number,
): number {
  return (e.paused_ms ?? 0) + (e.paused_at ? Math.max(0, nowMs - Date.parse(e.paused_at)) : 0);
}

export type RankedEntry = RaceEntry & {
  rank: number;
  state: EntryState;
  elapsed: number | null;
  /** 현재 수행 중인 구간 인덱스(0~구간수-1), 완주·대기는 null */
  current: number | null;
};

/** 순위: 완주(총시간↑) → 진행 중(더 앞선 종목, 같으면 경과↑) → 대기(참가 순). */
export function rankEntries(entries: RaceEntry[], nowMs: number, checkpoints = 6): RankedEntry[] {
  const rows = entries.map((e) => {
    const state = entryState(e);
    return {
      ...e,
      rank: 0,
      state,
      elapsed: elapsedOf(e, nowMs),
      current: state === "running" ? Math.min(e.splits.length, checkpoints - 1) : null,
    };
  });
  // 중도포기는 대기보다 뒤 — 더 볼 일이 없는 줄이다
  const order: Record<EntryState, number> = { finished: 0, running: 1, waiting: 2, dnf: 3 };
  rows.sort((a, b) => {
    if (order[a.state] !== order[b.state]) return order[a.state] - order[b.state];
    if (a.state === "finished") return (a.total_ms ?? 0) - (b.total_ms ?? 0);
    if (a.state === "running") {
      if (a.splits.length !== b.splits.length) return b.splits.length - a.splits.length;
      return (a.elapsed ?? 0) - (b.elapsed ?? 0);
    }
    return 0;
  });
  let rank = 0;
  for (const r of rows) {
    if (r.state === "waiting") continue;
    rank += 1;
    r.rank = rank;
  }
  return rows;
}

/** 러닝 클록 — 0.1초까지. 1시간을 넘으면 시:분:초 (하이록스 시뮬은 대부분 1시간을 넘는다) */
export function fmtClock(ms: number): string {
  const t = Math.max(0, ms);
  const h = Math.floor(t / 3600000);
  const m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const d = Math.floor((t % 1000) / 100);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}.${d}`;
}

/** 기기 시계(ms). 이벤트 핸들러·effect 에서만 부른다 — 렌더 중에는 쓰지 말 것. */
export function clockNow(): number {
  return Date.now();
}

/** i번째 구간 소요(ms) — 찍힌 구간만. 아니면 null */
export function segmentMs(splits: number[], i: number): number | null {
  if (i >= splits.length) return null;
  return splits[i] - (i === 0 ? 0 : splits[i - 1]);
}

/** 현재 구간 진행률(0~100). 기준 = 리더의 같은 구간 스플릿, 없으면 본인 직전 구간 평균.
 *  기준이 없으면 null(펄스만). 상한 100. */
export function segmentProgress(
  r: RaceEntry,
  currentElapsedMs: number,
  leaderSplits: number[] | null,
): number | null {
  const i = r.splits.length;
  const ref =
    leaderSplits && leaderSplits.length > i
      ? segmentMs(leaderSplits, i)
      : r.splits.length > 0
        ? r.splits[r.splits.length - 1] / r.splits.length
        : null;
  if (!ref || ref <= 0) return null;
  return Math.min(100, Math.round((currentElapsedMs / ref) * 100));
}

/** 아바타 색 — 이름 해시로 팔레트에서 고른다(보드 전용) */
const AVATAR_PALETTE = ["#ffd60a", "#f4a261", "#8ecae6", "#b5e48c", "#e0aaff", "#ffafcc"];
export function avatarColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h + ch.charCodeAt(0)) % 9973;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

export function initialOf(name: string): string {
  const s = name.trim();
  return s ? Array.from(s)[0].toUpperCase() : "?";
}

/** 시:분:초 (현장 시계·완주 시각) — 브라우저 로컬 시간대 */
export function fmtWallClock(d: Date, withSeconds = true): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return withSeconds ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
}
