/**
 * 공식 결과 사이트(results.hyrox.com — mika timing 계열 SSR) 검색.
 * 서버 전용 — API 라우트에서만 호출한다.
 *
 * 공식 검색 폼과 동일한 파라미터를 사용한다:
 *   pid=list & pidp=ranking_nav & event_main_group=<대회> &
 *   search[sex]=M|W & search[name]=<성> & search[firstname]=<이름>
 *
 * 원칙(S12): 사용자가 본인 이름으로 요청한 1회성 조회만 수행.
 * 대량 수집·저장 아님. 실패 시 빈 배열 — 폼의 URL/텍스트 폴백이 항상 남는다.
 */

const BASE = "https://results.hyrox.com";

/** 검색 대상 시즌 — 새 시즌 시작 시 앞에 추가 */
export const SEASONS = ["season-9", "season-8"] as const;
export type Season = (typeof SEASONS)[number];

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export type AthleteHit = {
  name: string;
  /** 목록 행에서 함께 읽은 문맥 (대회명·기록 등, 있을 때만) */
  context: string;
  season: string;
  /** 상세 페이지 절대 URL — /api/races/import 로 넘겨 스플릿을 읽는다 */
  detailUrl: string;
};

export type EventGroup = { value: string; label: string };

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en",
      },
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .trim();
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
}

// ------------------------------------------------------------
// 대회(event_main_group) 목록 — 검색 폼의 <select> 옵션을 그대로 파싱
// ------------------------------------------------------------
const groupCache = new Map<string, { at: number; groups: EventGroup[] }>();
const GROUP_TTL_MS = 6 * 60 * 60 * 1000;

export function parseEventGroups(html: string): EventGroup[] {
  // name="event_main_group" 또는 id에 event_main_group이 들어간 select
  const selectMatch = html.match(
    /<select[^>]*(?:name|id)="[^"]*event_main_group[^"]*"[^>]*>([\s\S]*?)<\/select>/i,
  );
  if (!selectMatch) return [];
  const groups: EventGroup[] = [];
  for (const m of selectMatch[1].matchAll(
    /<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi,
  )) {
    const value = decodeEntities(m[1]);
    const label = stripTags(m[2]);
    if (!value || !label) continue; // "모든 대회" 류의 빈 값 옵션 제외
    groups.push({ value, label });
  }
  return groups;
}

export async function fetchEventGroups(season: Season): Promise<EventGroup[]> {
  const cached = groupCache.get(season);
  if (cached && Date.now() - cached.at < GROUP_TTL_MS) return cached.groups;
  const html = await fetchHtml(`${BASE}/${season}/?pid=list&pidp=ranking_nav`);
  const groups = html ? parseEventGroups(html) : [];
  if (groups.length) groupCache.set(season, { at: Date.now(), groups });
  return groups;
}

// ------------------------------------------------------------
// 선수 검색
// ------------------------------------------------------------
export type SearchFilters = {
  season: Season;
  eventGroup?: string; // event_main_group 값 (없으면 시즌 전체)
  sex?: "M" | "W";
  lastName: string;
  firstName?: string;
};

/** 목록 HTML에서 선수 행(li/tr 블록) 단위로 이름+문맥 추출 */
export function parseAthleteList(html: string, season: string): AthleteHit[] {
  const hits: AthleteHit[] = [];
  const seen = new Set<string>();

  // idp 링크가 포함된 목록 블록(li 또는 tr) 단위로 자른다
  const blockRe = /<(li|tr)[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const b of html.matchAll(blockRe)) {
    const block = b[2];
    const link = block.match(
      /<a[^>]+href="([^"]*[?&](?:amp;)?idp=[^"]+)"[^>]*>([\s\S]{2,120}?)<\/a>/,
    );
    if (!link) continue;

    const href = decodeEntities(link[1]);
    const name = stripTags(link[2]);
    if (!name || /^(more|details?|»|>)$/i.test(name)) continue;

    const query = href.startsWith("http") ? null : href.replace(/^[./]*\??/, "");
    const abs = query === null ? href : `${BASE}/${season}/?${query}`;
    if (seen.has(abs)) continue;
    seen.add(abs);

    // 행 문맥: 이름을 제외한 텍스트에서 대회명/기록 후보를 짧게
    const context = stripTags(block)
      .replace(name, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);

    hits.push({ name, context, season, detailUrl: abs });
  }
  return hits;
}

/** 검색 조건 → 공식 사이트 검색 URL (딥링크·서버 조회 공용, 순수 함수) */
export function buildSearchUrl(filters: SearchFilters): string {
  const params = new URLSearchParams({
    pid: "list",
    pidp: "ranking_nav",
    num_results: "100",
  });
  params.set("search[name]", filters.lastName.trim());
  if (filters.firstName?.trim())
    params.set("search[firstname]", filters.firstName.trim());
  if (filters.sex) params.set("search[sex]", filters.sex);
  if (filters.eventGroup) params.set("event_main_group", filters.eventGroup);
  return `${BASE}/${filters.season}/?${params}`;
}

export async function searchAthletes(
  filters: SearchFilters,
): Promise<{ hits: AthleteHit[]; blocked: boolean }> {
  const last = filters.lastName.trim();
  if (last.length < 2) return { hits: [], blocked: false };

  const url = buildSearchUrl(filters);
  const html = await fetchHtml(url);
  // 결과 사이트가 데이터센터 IP를 WAF로 차단하는 경우가 있어 진단 로그를 남긴다
  console.log(
    JSON.stringify({
      tag: "hyrox-results-search",
      url,
      fetched: html !== null,
      htmlLen: html?.length ?? 0,
    }),
  );
  if (!html) return { hits: [], blocked: true };
  return { hits: parseAthleteList(html, filters.season).slice(0, 30), blocked: false };
}
