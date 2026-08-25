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

import type { EventDivisionStat } from "@/lib/event-stats";
export type { EventDivisionStat } from "@/lib/event-stats";

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

export { percentileWithin } from "@/lib/event-stats";

/** 같은 도시의 가장 최근 "결과 있는" 회차 통계 — 미래 대회의 참고 실측용.
 *  현재+직전 시즌 이벤트를 훑어 도시가 일치하는 최신 주말의 상위 디비전 통계를 준다. */
export async function getCityLatestStats(
  cityCandidates: string[],
): Promise<{ label: string; divisions: EventDivisionStat[] } | null> {
  if (!process.env.HYROX_RESULT_API_TOKEN || !cityCandidates.length) return null;
  // 한국어 표기 후보는 영문으로도 확장 (큐레이션 행 대응)
  const allCandidates = [
    ...cityCandidates,
    ...cityCandidates.map((c) => EN_BY_KO[c]).filter((c): c is string => !!c),
  ];
  const key = allCandidates[0].toLowerCase();
  const cached = unstable_cache(
    async () => {
      const wanted = allCandidates.map((c) => c.toLowerCase());
      const rows: ApiEventRow[] = [];
      for (const season of ["season-9", "season-8"]) {
        const json = (await apiGet(
          `/events?season=${season}&per_page=100`,
        )) as { data?: ApiEventRow[] } | null;
        for (const e of json?.data ?? []) {
          if (
            wanted.includes(stripYear(e.city).toLowerCase()) &&
            (e.results_count ?? 0) > 0
          )
            rows.push(e);
        }
        if (rows.length) break; // 현 시즌에 있으면 충분
      }
      if (!rows.length) return null;
      // 최신 주말 클러스터
      const latestStart = rows
        .map((e) => e.start_date ?? "")
        .sort()
        .at(-1);
      const cluster = rows
        .filter((e) => e.start_date === latestStart)
        .sort((a, b) => (b.results_count ?? 0) - (a.results_count ?? 0))
        .slice(0, 4);
      const stats = await Promise.all(
        cluster.map((e) => apiGet(`/stats/divisions/${e.id}`)),
      );
      const divisions: EventDivisionStat[] = [];
      cluster.forEach((e, i) => {
        const row = (stats[i] as {
          data?: {
            divisions?: {
              count: number;
              median_total_time_ms: number | null;
              p10_total_time_ms: number | null;
              p25_total_time_ms: number | null;
              p75_total_time_ms: number | null;
              p90_total_time_ms: number | null;
            }[];
          };
        } | null)?.data?.divisions?.[0];
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
      return divisions.length
        ? { label: cluster[0] ? stripYear(cluster[0].city) + ` (${latestStart})` : "", divisions }
        : null;
    },
    ["city-latest-stats", key],
    { revalidate: 6 * 3600 },
  );
  try {
    return await cached();
  } catch {
    return null;
  }
}
