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
};

export type BoardData = { race: RaceInfo; server_now: string; entries: RaceEntry[] };

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
  status: RaceStatus;
};

export type EntryState = "waiting" | "running" | "finished";

export function entryState(e: Pick<RaceEntry, "started_at" | "finished_at">): EntryState {
  if (e.finished_at) return "finished";
  if (e.started_at) return "running";
  return "waiting";
}

/** 지금 경과(ms). 완주는 총시간, 진행 중은 보드 시계 기준, 대기는 null.
 *  @param nowMs 보정된 현재 시각(Date.now() + 서버 오프셋) */
export function elapsedOf(e: RaceEntry, nowMs: number): number | null {
  if (e.finished_at) return e.total_ms;
  if (!e.started_at) return null;
  return Math.max(0, nowMs - Date.parse(e.started_at));
}

export type RankedEntry = RaceEntry & {
  rank: number;
  state: EntryState;
  elapsed: number | null;
  /** 현재 수행 중인 종목 인덱스(0~5), 완주·대기는 null */
  current: number | null;
};

/** 순위: 완주(총시간↑) → 진행 중(더 앞선 종목, 같으면 경과↑) → 대기(참가 순). */
export function rankEntries(entries: RaceEntry[], nowMs: number): RankedEntry[] {
  const rows = entries.map((e) => {
    const state = entryState(e);
    return {
      ...e,
      rank: 0,
      state,
      elapsed: elapsedOf(e, nowMs),
      current: state === "running" ? Math.min(e.splits.length, 5) : null,
    };
  });
  const order: Record<EntryState, number> = { finished: 0, running: 1, waiting: 2 };
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

/** 러닝 클록 — 0.1초까지 */
export function fmtClock(ms: number): string {
  const t = Math.max(0, ms);
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const d = Math.floor((t % 1000) / 100);
  return `${m}:${String(s).padStart(2, "0")}.${d}`;
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
