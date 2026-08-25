/**
 * HYROX Result API (hyroxresultapi.com — 구독형) 어댑터. 서버 전용.
 *
 * HYROX_RESULT_API_TOKEN(Vercel 환경 변수)이 있으면 검색·임포트가
 * 스크래핑(hyrox-results.ts) 대신 이 경로를 탄다 — 구조 변경에 강하고
 * 스플릿이 ms 정밀도로 온다. 토큰이 없으면 기존 스크래핑 폴백 유지.
 *
 * 원칙(S12)은 동일: 사용자가 본인 이름으로 요청한 1회성 조회만 수행.
 */

import type { ParsedRace } from "@/lib/race-import";

const BASE =
  process.env.HYROX_RESULT_API_BASE ?? "https://hyroxresultapi.com/api/v1";

export const API_DETAIL_PREFIX = "hyrox-api:";

export function resultApiEnabled(): boolean {
  return !!process.env.HYROX_RESULT_API_TOKEN;
}

async function apiGet(path: string): Promise<unknown | null> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      authorization: `Bearer ${process.env.HYROX_RESULT_API_TOKEN}`,
      accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`result api ${res.status}`);
  return res.json();
}

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "";
  const t = Math.round(ms / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

type SearchHit = {
  id: string;
  person_ref: string | null;
  display_name: string;
  nationality: string | null;
  sex: string | null;
  event_name: string | null;
  total_time_ms: number | null;
  rank_overall: number | null;
};

export type ApiAthleteHit = {
  name: string;
  context: string;
  season: string;
  detailUrl: string;
  /** 인물 식별자 — 프로필 연동(자동 동기화)용. 스크래핑 폴백에는 없음 */
  personRef?: string | null;
};

/** 이름 검색 — AthleteHit(폼 계약)과 같은 모양으로 반환 */
export async function apiSearchAthletes(params: {
  season: string;
  lastName: string;
  firstName?: string;
}): Promise<ApiAthleteHit[]> {
  const q = new URLSearchParams({
    last: params.lastName,
    first: params.firstName ?? params.lastName,
    season: params.season,
  });
  const json = (await apiGet(`/athletes/search?${q}`)) as {
    data?: SearchHit[];
  } | null;
  return (json?.data ?? []).map((h) => ({
    name: h.display_name,
    context: [
      h.event_name ?? "",
      fmtMs(h.total_time_ms),
      h.rank_overall != null ? `#${h.rank_overall}` : "",
      h.nationality ?? "",
    ]
      .filter(Boolean)
      .join(" · "),
    season: params.season,
    detailUrl: `${API_DETAIL_PREFIX}${h.id}`,
    personRef: h.person_ref ?? null,
  }));
}

/** division_name → 우리 디비전 코드 */
function mapDivision(name: string | null | undefined): string | undefined {
  const k = String(name ?? "").toUpperCase();
  if (!k) return undefined;
  if (/MIXED\s+DOUBLES/.test(k)) return "mixed_doubles";
  if (/PRO\s+DOUBLES/.test(k)) return "pro_doubles";
  if (/DOUBLES/.test(k)) return "doubles";
  if (/RELAY/.test(k)) return "relay";
  if (/PRO/.test(k)) return "pro";
  if (/HYROX/.test(k)) return "open";
  return undefined;
}

// canonical_key → STATIONS key
const STATION_BY_KEY: Record<string, string> = {
  ski_erg: "ski",
  sled_push: "sledpush",
  sled_pull: "sledpull",
  burpee_broad_jump: "burpee",
  burpee_broad_jumps: "burpee",
  row: "row",
  rowing: "row",
  farmers_carry: "farmers",
  sandbag_lunges: "lunges",
  lunges: "lunges",
  wall_balls: "wallballs",
};

type SplitRow = {
  canonical_key: string | null;
  time_ms: number | null;
  order_index: number | null;
  /** 그 대회 필드에서의 스플릿별 순위 */
  place?: number | null;
};
type RaceDetail = {
  display_name: string | null;
  total_time_ms: number | null;
  race_name: string | null;
  division_name: string | null;
  rank_overall?: number | null;
  sex?: string | null;
};

/** 레이스 상세 + 스플릿 → ParsedRace (기존 임포트 파이프라인 계약) */
export async function apiFetchRace(raceId: string): Promise<ParsedRace | null> {
  const enc = encodeURIComponent(raceId);
  const [detailJson, splitsJson] = await Promise.all([
    apiGet(`/athletes/${enc}`) as Promise<{ data?: RaceDetail } | null>,
    apiGet(`/athletes/${enc}/splits`) as Promise<{ data?: SplitRow[] } | null>,
  ]);
  const detail = detailJson?.data;
  if (!detail) return null;

  const parsed: ParsedRace = { stations: {} };
  if (detail.race_name) parsed.event = detail.race_name;
  if (detail.total_time_ms != null) parsed.totalMs = detail.total_time_ms;
  let div = mapDivision(detail.division_name);
  // 더블은 sex 값으로 mixed 여부 판별 (이벤트명엔 MIXED 가 없을 수 있음)
  const sx = String(detail.sex ?? "").toUpperCase();
  if (div === "doubles" && (/^(X|MX)$/.test(sx) || sx.includes("MIX")))
    div = "mixed_doubles";
  if (div) parsed.division = div;

  if (detail.rank_overall != null) parsed.rankOverall = detail.rank_overall;

  const runs: number[] = [];
  const runsPlace: (number | null)[] = [];
  const roxzones: number[] = [];
  const stationsPlace: Record<string, number> = {};
  for (const s of splitsJson?.data ?? []) {
    // 구형 레이스는 "run1_time"/"ski_erg_time" 형태 — _time 접미 제거
    const key = String(s.canonical_key ?? "")
      .toLowerCase()
      .replace(/_time$/, "");
    const ms = s.time_ms;
    if (ms == null) continue;
    const place =
      s.place != null && Number(s.place) > 0 ? Number(s.place) : null;
    const run = key.match(/^run[_ ]?(\d)$/);
    const rox = key.match(/^rox_?zone[_ ]?(\d)$/);
    if (run) {
      runs[Number(run[1]) - 1] = ms;
      runsPlace[Number(run[1]) - 1] = place;
    } else if (rox) roxzones[Number(rox[1]) - 1] = ms;
    else if (STATION_BY_KEY[key] != null) {
      const st = STATION_BY_KEY[key];
      if (parsed.stations[st] == null) {
        parsed.stations[st] = ms;
        if (place != null) stationsPlace[st] = place;
      }
    }
  }
  const runsClean = runs.filter((v) => v != null);
  if (runsClean.length === 8) {
    parsed.runs = runsClean;
    parsed.runTotalMs = runsClean.reduce((a, b) => a + b, 0);
    if (runsPlace.some((v) => v != null)) parsed.runsPlace = runsPlace;
  }
  if (Object.keys(stationsPlace).length) parsed.stationsPlace = stationsPlace;
  const roxClean = roxzones.filter((v) => v != null);
  if (roxClean.length > 0) {
    parsed.roxzones = roxClean;
    parsed.roxzoneTotalMs = roxClean.reduce((a, b) => a + b, 0);
  }
  return parsed;
}
