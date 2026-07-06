/**
 * 공식 결과 사이트(results.hyrox.com — mika timing 계열) 검색.
 * 서버 전용 — API 라우트에서만 호출한다.
 *
 * 공식 검색 폼(?pid=start)의 실측 필드(2026-07-06 확인)를 그대로 사용:
 *   event_main_group=<대회> & event=<세부 이벤트> & search[name]=<성> &
 *   search[firstname]=<이름> & search[sex]=M|W & search[age_class] &
 *   search[nation] & num_results — 제출 대상은 ?pid=list
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
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
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
  // 검색 폼(?pid=start)의 대회 선택: <select name="event_main_group"> (실측: 2026-07-06)
  const selectMatch = html.match(
    /<select[^>]*name="event_main_group"[^>]*>([\s\S]*?)<\/select>/i,
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
  const html = await fetchHtml(`${BASE}/${season}/?pid=start&pidp=ranking_nav`);
  const groups = html ? parseEventGroups(html) : [];
  if (groups.length) groupCache.set(season, { at: Date.now(), groups });
  return groups;
}

// ------------------------------------------------------------
// 선수 검색
// ------------------------------------------------------------
export type SearchFilters = {
  season: Season;
  eventGroup?: string; // event_main_group 값 (공식 폼의 대회 선택, 없으면 전체)
  division?: string; // 목록 페이지 select name="event"의 값 (없으면 전 디비전)
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

/**
 * 검색 조건 → 공식 사이트 검색 URL (딥링크·서버 조회 공용, 순수 함수).
 * 주의: 사이트의 search[firstname]은 사실상 정확일치라(실측: "Cho",
 * "Choho" 모두 0건) 보내지 않는다 — 이름은 결과 목록에 부분일치로 적용.
 */
export function buildSearchUrl(filters: SearchFilters): string {
  const params = new URLSearchParams({
    pid: "list",
    pidp: "ranking_nav",
    num_results: "100",
  });
  params.set("search[name]", filters.lastName.trim());
  if (filters.sex) params.set("search[sex]", filters.sex);
  if (filters.eventGroup) params.set("event_main_group", filters.eventGroup);
  if (filters.division) params.set("event", filters.division);
  return `${BASE}/${filters.season}/?${params}`;
}

/** 목록 페이지의 디비전 선택(select name="event") 옵션 파싱 */
export function parseDivisionOptions(html: string): EventGroup[] {
  const selectMatch = html.match(
    /<select[^>]*name="event"[^>]*>([\s\S]*?)<\/select>/i,
  );
  if (!selectMatch) return [];
  const out: EventGroup[] = [];
  for (const m of selectMatch[1].matchAll(
    /<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi,
  )) {
    const value = decodeEntities(m[1]);
    const label = stripTags(m[2]);
    if (value && label) out.push({ value, label });
  }
  return out;
}

/** 대회의 디비전 목록 — 검색 폼 드롭다운용 */
export async function fetchDivisions(
  season: Season,
  eventGroup: string,
): Promise<EventGroup[]> {
  const params = new URLSearchParams({
    pid: "list",
    pidp: "ranking_nav",
    event_main_group: eventGroup,
  });
  const html = await fetchHtml(`${BASE}/${season}/?${params}`);
  return html ? parseDivisionOptions(html) : [];
}

/** 이름 비교용 정규화: 소문자 + 영문자 외 제거 ("Cho Ho"≈"choho") */
function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

export async function searchAthletes(filters: SearchFilters): Promise<{
  hits: AthleteHit[];
  blocked: boolean;
  /** firstName을 줬을 때: 목록에서 부분일치가 있었는지 (없으면 전체 목록 반환) */
  firstNameMatched?: boolean;
}> {
  const last = filters.lastName.trim();
  if (last.length < 2) return { hits: [], blocked: false };

  const url = buildSearchUrl(filters);
  const html = await fetchHtml(url);
  console.log(
    JSON.stringify({
      tag: "hyrox-results-search",
      url,
      fetched: html !== null,
      htmlLen: html?.length ?? 0,
    }),
  );
  if (!html) return { hits: [], blocked: true };

  const divisions = parseDivisionOptions(html);
  const first = parseAthleteList(html, filters.season);
  // 첫 응답의 디비전 라벨: 링크의 event= 코드와 일치하는 옵션
  const firstDiv = divisions.find((d) =>
    first[0]?.detailUrl.includes(`event=${encodeURIComponent(d.value)}`) ||
    first[0]?.detailUrl.includes(`event=${d.value}`),
  );

  const lists: { label?: string; hits: AthleteHit[] }[] = [
    { label: firstDiv?.label, hits: first },
  ];

  // 디비전을 지정하지 않은 대회 검색은 기본 디비전만 반환하므로
  // 나머지 디비전도 조회
  if (!filters.division && filters.eventGroup && divisions.length > 1) {
    const rest = divisions.filter((d) => d.value !== firstDiv?.value).slice(0, 14);
    const pages = await Promise.all(
      rest.map((d) => fetchHtml(`${url}&event=${encodeURIComponent(d.value)}`)),
    );
    pages.forEach((p, i) => {
      if (p)
        lists.push({
          label: rest[i].label,
          hits: parseAthleteList(p, filters.season),
        });
    });
  }

  // 라운드로빈 병합 — 100건 상한이 첫 디비전(싱글)에만 쏠려
  // 더블즈/릴레이가 잘려나가지 않도록 디비전을 번갈아 채운다
  let hits: AthleteHit[] = [];
  const seen = new Set<string>();
  for (let i = 0; ; i++) {
    let any = false;
    for (const l of lists) {
      const h = l.hits[i];
      if (!h) continue;
      any = true;
      if (seen.has(h.detailUrl)) continue;
      seen.add(h.detailUrl);
      hits.push(l.label ? { ...h, context: `${l.label} · ${h.context}` } : h);
    }
    if (!any) break;
  }

  // 이름(first name)은 서버에서 부분일치 필터 — 더블즈는 팀 문자열
  // 전체("GAIN OH, CHOHO KIM")에 걸리므로 두 멤버 모두 매칭된다.
  // 걸리는 게 없으면 전체 목록 유지 + firstNameMatched=false 로 알린다.
  let firstNameMatched: boolean | undefined;
  if (filters.firstName?.trim()) {
    const f = normName(filters.firstName);
    if (f) {
      const matched = hits.filter((h) => normName(h.name).includes(f));
      firstNameMatched = matched.length > 0;
      if (matched.length) hits = matched;
    }
  }
  return { hits: hits.slice(0, 100), blocked: false, firstNameMatched };
}
