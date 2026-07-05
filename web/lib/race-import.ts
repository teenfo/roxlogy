/**
 * 공식 결과 페이지 → 레이스 결과 자동 인식.
 *
 * 원칙(S12): 사용자가 명시적으로 제출한 "본인 결과" URL/텍스트 1건만
 * 요청 시점에 파싱한다 — 대량 수집·비교군 구축 아님.
 * 사이트 구조에 의존하지 않도록 키워드+시간 패턴 기반 텍스트 파싱을
 * 기본으로 하고, 실패 시 사용자가 페이지 텍스트를 붙여넣는 폴백을 둔다.
 */

export type ParsedRace = {
  event?: string;
  eventDate?: string; // YYYY-MM-DD
  division?: string;
  totalMs?: number;
  runTotalMs?: number;
  stations: Record<string, number>; // STATIONS key → ms
};

/** URL 가져오기를 허용하는 결과 사이트 (SSRF 방지 겸 목적 제한) */
export const ALLOWED_IMPORT_HOSTS = [
  "results.hyrox.com",
  "hyrox.com",
  "www.hyrox.com",
  "hyresult.com",
  "www.hyresult.com",
  "sporthive.com",
  "eventresults.sporthive.com",
  "www.sporthive.com",
];

export function isAllowedImportUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    return ALLOWED_IMPORT_HOSTS.some(
      (h) => u.hostname === h || u.hostname.endsWith(`.${h}`),
    );
  } catch {
    return false;
  }
}

/** HTML → 대략적 텍스트 (스크립트/스타일 제거, 태그를 개행으로) */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<(br|\/tr|\/li|\/p|\/div|\/h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, " ");
}

// 스테이션 키워드 — 구체적인 것 먼저 매칭 (예: "sled push" 전에 "push"만으로 잡지 않게)
const STATION_KEYWORDS: [string, RegExp][] = [
  ["ski", /ski\s*erg/i],
  ["sledpush", /sled\s*push/i],
  ["sledpull", /sled\s*pull/i],
  ["burpee", /burpee/i],
  ["row", /row(?:ing|er)?\b/i],
  ["farmers", /farmer'?s?\s*carry/i],
  ["lunges", /lunge/i],
  ["wallballs", /wall\s*balls?/i],
];

const TIME_RE = /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/;

function timeTokenToMs(m: RegExpMatchArray): number {
  const [, a, b, c] = m;
  const sec = c
    ? Number(a) * 3600 + Number(b) * 60 + Number(c)
    : Number(a) * 60 + Number(b);
  return sec * 1000;
}

/** 결과 페이지 텍스트에서 레이스 데이터 추출 (best-effort) */
export function parseRaceText(text: string): ParsedRace {
  const lines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const out: ParsedRace = { stations: {} };
  const runLaps: number[] = [];

  for (const line of lines) {
    const time = line.match(TIME_RE);

    // 대회명: "HYROX <도시>" 패턴 첫 등장
    if (!out.event) {
      const ev = line.match(/HYROX\s+[A-Za-z][A-Za-z .'’-]*[A-Za-z.]/);
      if (ev) out.event = ev[0].replace(/\s+/g, " ").trim();
    }

    // 날짜: YYYY-MM-DD / YYYY.MM.DD / DD.MM.YYYY
    if (!out.eventDate) {
      const iso = line.match(/\b(20\d{2})[-./](\d{1,2})[-./](\d{1,2})\b/);
      const eu = line.match(/\b(\d{1,2})[./](\d{1,2})[./](20\d{2})\b/);
      if (iso)
        out.eventDate = `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
      else if (eu)
        out.eventDate = `${eu[3]}-${eu[2].padStart(2, "0")}-${eu[1].padStart(2, "0")}`;
    }

    // 디비전
    if (!out.division) {
      if (/pro\s*doubles/i.test(line)) out.division = "pro_doubles";
      else if (/\bdoubles\b/i.test(line)) out.division = "doubles";
      else if (/\brelay\b/i.test(line)) out.division = "relay";
      else if (/\bpro\b/i.test(line)) out.division = "pro";
      else if (/\bopen\b/i.test(line)) out.division = "open";
    }

    if (!time) continue;
    const ms = timeTokenToMs(time);

    // 총 기록: "total"/"finish" 라인의 h:mm:ss
    if (/total|finish|overall/i.test(line) && time[3] != null) {
      if (/run/i.test(line)) {
        out.runTotalMs = out.runTotalMs ?? ms;
      } else {
        out.totalMs = out.totalMs ?? ms;
      }
      continue;
    }

    // 런 랩: "Run 1" ~ "Run 8" / "Running 1000m"
    if (/\brun(?:ning)?\s*[1-8]?\b/i.test(line) && !/roxzone/i.test(line)) {
      if (runLaps.length < 8) runLaps.push(ms);
      continue;
    }

    // 스테이션
    for (const [key, re] of STATION_KEYWORDS) {
      if (re.test(line)) {
        if (out.stations[key] == null && ms < 60 * 60_000)
          out.stations[key] = ms;
        break;
      }
    }
  }

  if (out.runTotalMs == null && runLaps.length === 8)
    out.runTotalMs = runLaps.reduce((a, b) => a + b, 0);

  // 총 기록을 못 찾았으면 텍스트 내 최대 h:mm:ss 값으로 추정
  if (out.totalMs == null) {
    let max = 0;
    for (const m of text.matchAll(new RegExp(TIME_RE.source, "g"))) {
      if (m[3] != null) max = Math.max(max, timeTokenToMs(m));
    }
    if (max > 0) out.totalMs = max;
  }

  return out;
}

/** 인식된 필드 수 — 폼에서 "N개 항목 인식" 안내용 */
export function parsedFieldCount(p: ParsedRace): number {
  return (
    Object.keys(p.stations).length +
    (p.totalMs != null ? 1 : 0) +
    (p.runTotalMs != null ? 1 : 0) +
    (p.event ? 1 : 0) +
    (p.eventDate ? 1 : 0) +
    (p.division ? 1 : 0)
  );
}
