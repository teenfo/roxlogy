/**
 * 공식 결과 사이트(results.hyrox.com — mika timing 계열 SSR) 검색.
 * 서버 전용 — API 라우트에서만 호출한다.
 *
 * 원칙(S12): 사용자가 본인 이름으로 요청한 1회성 조회만 수행.
 * 대량 수집·저장 아님. 사이트 구조 변경에 대비해 실패 시 빈 배열을
 * 반환하고, 폼의 URL/텍스트 폴백이 항상 남아 있다.
 */

const BASE = "https://results.hyrox.com";

/** 검색 대상 시즌 — 새 시즌 시작 시 앞에 추가 */
export const SEASONS = ["season-9", "season-8"] as const;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export type AthleteHit = {
  name: string;
  season: string;
  /** 상세 페이지 절대 URL — /api/races/import 로 넘겨 스플릿을 읽는다 */
  detailUrl: string;
};

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

/** 목록 HTML에서 선수 상세 링크(idp=) 추출 */
export function parseAthleteList(
  html: string,
  season: string,
): AthleteHit[] {
  const hits: AthleteHit[] = [];
  const seen = new Set<string>();
  const re =
    /<a[^>]+href="([^"]*[?&](?:amp;)?idp=[^"]+)"[^>]*>([^<]{2,80})<\/a>/g;
  for (const m of html.matchAll(re)) {
    const href = decodeEntities(m[1]);
    const name = decodeEntities(m[2]).replace(/\s+/g, " ");
    if (!name || /^more|^details?$/i.test(name)) continue;
    const query = href.startsWith("http")
      ? null
      : href.replace(/^[./]*\??/, "");
    const abs = query === null ? href : `${BASE}/${season}/?${query}`;
    if (seen.has(abs)) continue;
    seen.add(abs);
    hits.push({ name, season, detailUrl: abs });
  }
  return hits;
}

function listUrl(season: string, params: Record<string, string>): string {
  const q = new URLSearchParams({ pid: "list", num_results: "25", ...params });
  return `${BASE}/${season}/?${q.toString()}`;
}

/**
 * 이름으로 선수 검색 — 시즌별로 조회해 병합.
 * mika 검색은 search[name]=성 기준이라, 입력이 2단어 이상이면
 * "성만" / "이름+성 분리" 두 가지 쿼리를 모두 시도한다.
 */
export async function searchAthletes(query: string): Promise<AthleteHit[]> {
  const q = query.trim().replace(/\s+/g, " ");
  if (q.length < 2) return [];

  const tokens = q.split(" ");
  const variants: Record<string, string>[] = [{ "search[name]": q }];
  if (tokens.length >= 2) {
    const first = tokens.slice(0, -1).join(" ");
    const last = tokens[tokens.length - 1];
    variants.push({ "search[name]": last, "search[firstname]": first });
    variants.push({ "search[name]": tokens[0], "search[firstname]": tokens.slice(1).join(" ") });
  }

  const results: AthleteHit[] = [];
  const seen = new Set<string>();
  for (const season of SEASONS) {
    for (const params of variants) {
      const html = await fetchHtml(listUrl(season, params));
      if (!html) continue;
      for (const hit of parseAthleteList(html, season)) {
        if (seen.has(hit.detailUrl)) continue;
        seen.add(hit.detailUrl);
        results.push(hit);
      }
      if (results.length >= 20) return results.slice(0, 20);
      // 이 변형에서 결과가 나왔으면 같은 시즌의 다른 변형은 생략
      if (results.some((r) => r.season === season)) break;
    }
  }
  return results.slice(0, 20);
}

export { BROWSER_UA };
