/**
 * 대회 상세 라이브 데이터 — Result API 프록시 (서버 전용, 1시간 캐시).
 *
 * 우리 race_events 행(대회 주말 단위)에 해당하는 API 이벤트(디비전×요일 행)를
 * 날짜 범위 + 도시로 찾아, 디비전 목록·완주 통계·수집 상태를 모아 준다.
 * Starter 레이트리밋(분당 30) 보호: 페이지 요청당 API 호출 ≤ 8회 + 1시간 캐시.
 * 토큰 미설정/실패 시 null — 페이지는 기본 정보만 표시한다.
 */

import { unstable_cache } from "next/cache";

const BASE =
  process.env.HYROX_RESULT_API_BASE ?? "https://hyroxresultapi.com/api/v1";

// 동기화 스크립트 CITY_KO 의 역방향 (큐레이션 행은 api_city 가 없어 이걸로 폴백)
const EN_BY_KO: Record<string, string> = {
  서울: "Seoul", 인천: "Incheon", 홍콩: "Hong Kong", 오사카: "Osaka",
  도쿄: "Tokyo", 지바: "Chiba", 방콕: "Bangkok", 타이베이: "Taipei",
  싱가포르: "Singapore", 뭄바이: "Mumbai", 자카르타: "Jakarta",
  베이징: "Beijing", 상하이: "Shanghai", 선전: "Shenzhen",
  광저우: "Guangzhou", 청두: "Chengdu", 항저우: "Hangzhou", 델리: "Delhi",
  마스트리흐트: "Maastricht", 솔트레이크시티: "Salt Lake City",
  애너하임: "Anaheim", 밴쿠버: "Vancouver", 퍼스: "Perth",
  시드니: "Sydney", 케이프타운: "Cape Town", 이스탄불: "Istanbul",
  "워싱턴 DC": "Washington DC", 리우데자네이루: "Rio de Janeiro",
  부에노스아이레스: "Buenos Aires",
};

async function apiGet(path: string): Promise<unknown | null> {
  if (!process.env.HYROX_RESULT_API_TOKEN) return null;
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      authorization: `Bearer ${process.env.HYROX_RESULT_API_TOKEN}`,
      accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  return res.json();
}

const stripYear = (c: string) =>
  String(c ?? "").replace(/^\s*(19|20)\d{2}\s+/, "").trim();

type ApiEventRow = {
  id: number;
  slug: string;
  name: string;
  city: string;
  start_date: string | null;
  end_date: string | null;
  results_count: number | null;
};

export type EventDivisionStat = {
  label: string; // API 디비전 이름 (예: "HYROX PRO - Saturday")
  count: number;
  medianMs: number | null;
  p10Ms: number | null;
  p25Ms: number | null;
  p75Ms: number | null;
  p90Ms: number | null;
};

export type EventLiveDetail = {
  phase: "scheduled" | "racing" | "finished" | "unknown" | null;
  resultsDueOn: string | null;
  totalFinishers: number;
  divisions: EventDivisionStat[];
};

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function fetchLiveDetail(
  season: string | null,
  startDate: string,
  endDate: string | null,
  cityCandidates: string[],
): Promise<EventLiveDetail | null> {
  // 시즌 표기 'S9 2026/27' → API slug 'season-9'
  const n = season?.match(/^S(\d+)/)?.[1];
  const seasonQ = n ? `&season=season-${n}` : "";
  const from = addDays(startDate, -1);
  const to = addDays(endDate ?? startDate, 1);
  const json = (await apiGet(
    `/events?from=${from}&to=${to}&per_page=100${seasonQ}`,
  )) as { data?: ApiEventRow[] } | null;
  if (!json?.data?.length) return null;

  const wanted = cityCandidates.map((c) => c.toLowerCase()).filter(Boolean);
  const mine = json.data.filter((e) =>
    wanted.includes(stripYear(e.city).toLowerCase()),
  );
  if (!mine.length) return null;

  // 통계는 완주자 수 상위 6개 디비전만 (레이트리밋 예산)
  const top = [...mine]
    .filter((e) => (e.results_count ?? 0) > 0)
    .sort((a, b) => (b.results_count ?? 0) - (a.results_count ?? 0))
    .slice(0, 6);

  const [statusJson, ...statJsons] = await Promise.all([
    apiGet(`/events/${encodeURIComponent(mine[0].slug)}/ingest-status`),
    ...top.map((e) => apiGet(`/stats/divisions/${e.id}`)),
  ]);

  const race = (statusJson as {
    data?: { race?: { phase?: string; results_due_on?: string } };
  } | null)?.data?.race;

  const divisions: EventDivisionStat[] = [];
  top.forEach((e, i) => {
    const d = (statJsons[i] as {
      data?: {
        count?: number;
        divisions?: {
          count: number;
          median_total_time_ms: number | null;
          p10_total_time_ms: number | null;
          p25_total_time_ms: number | null;
          p75_total_time_ms: number | null;
          p90_total_time_ms: number | null;
        }[];
      };
    } | null)?.data;
    const row = d?.divisions?.[0];
    if (!row) return;
    divisions.push({
      label: e.name,
      count: row.count,
      medianMs: row.median_total_time_ms,
      p10Ms: row.p10_total_time_ms,
      p25Ms: row.p25_total_time_ms,
      p75Ms: row.p75_total_time_ms,
      p90Ms: row.p90_total_time_ms,
    });
  });

  return {
    phase:
      race?.phase === "scheduled" ||
      race?.phase === "racing" ||
      race?.phase === "finished"
        ? race.phase
        : race
          ? "unknown"
          : null,
    resultsDueOn: race?.results_due_on ?? null,
    totalFinishers: mine.reduce((a, e) => a + (e.results_count ?? 0), 0),
    divisions,
  };
}

/** 대회 상세 라이브 데이터 (1시간 캐시, 대회별 키) */
export async function getEventLiveDetail(row: {
  id: string;
  city: string;
  api_city: string | null;
  season: string | null;
  start_date: string | null;
  end_date: string | null;
}): Promise<EventLiveDetail | null> {
  if (!process.env.HYROX_RESULT_API_TOKEN || !row.start_date) return null;
  const cities = [row.api_city, EN_BY_KO[row.city], row.city].filter(
    (c): c is string => !!c,
  );
  const cached = unstable_cache(
    () => fetchLiveDetail(row.season, row.start_date!, row.end_date, cities),
    ["event-live-detail", row.id],
    { revalidate: 3600 },
  );
  try {
    return await cached();
  } catch {
    return null;
  }
}

/** p10~p90 브레이크포인트에서 목표 시간의 백분위 보간 (상위 %) */
export function percentileWithin(
  targetMs: number,
  s: EventDivisionStat,
): number | null {
  const pts: [number, number][] = [];
  if (s.p10Ms != null) pts.push([10, s.p10Ms]);
  if (s.p25Ms != null) pts.push([25, s.p25Ms]);
  if (s.medianMs != null) pts.push([50, s.medianMs]);
  if (s.p75Ms != null) pts.push([75, s.p75Ms]);
  if (s.p90Ms != null) pts.push([90, s.p90Ms]);
  if (pts.length < 2) return null;
  if (targetMs <= pts[0][1])
    return Math.max(1, Math.round((targetMs / pts[0][1]) * pts[0][0]));
  const last = pts[pts.length - 1];
  if (targetMs >= last[1]) return last[0];
  for (let i = 0; i < pts.length - 1; i++) {
    const [pA, tA] = pts[i];
    const [pB, tB] = pts[i + 1];
    if (targetMs >= tA && targetMs <= tB) {
      const cdf = tB === tA ? pB : pA + ((pB - pA) * (targetMs - tA)) / (tB - tA);
      return Math.round(cdf);
    }
  }
  return null;
}
