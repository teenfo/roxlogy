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
  roxzoneTotalMs?: number;
  stations: Record<string, number>; // STATIONS key → ms
  /** 런 랩 1~8 (ms) — 리플레이 또는 스플릿 표에서 */
  runs?: number[];
  /** 록스존 1~8 (ms) — 리플레이 In/Out에서 산출 */
  roxzones?: number[];
  /** 리플레이 기반 24구간 (런→록스존→스테이션 × 8, 세션 변환용) */
  segments?: RaceSegment[];
  /** 레이스 출발 시각 "HH:MM:SS" (대회 현지 시계) */
  startClock?: string;
};

export type RaceSegment = {
  kind: "run" | "roxzone" | "station";
  /** 스테이션이면 hyrox.ts STATIONS key */
  stationKey: string | null;
  /** 그룹 번호 1~8 */
  n: number;
  splitMs: number;
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

/**
 * HTML → 대략적 텍스트.
 * 원본 소스의 개행을 먼저 무력화한 뒤(테이블 셀이 소스상 여러 줄로
 * 쪼개져 있어도 한 행 = 한 줄이 되도록) 블록 경계 태그만 개행으로 바꾼다.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/<(br|\/tr|\/li|\/p|\/div|\/h[1-6]|\/table)[^>]*>/gi, "\n")
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

    // 스플릿 표의 "Roxzone Time" 합계
    if (/roxzone/i.test(line)) {
      if (out.roxzoneTotalMs == null && ms < 60 * 60_000)
        out.roxzoneTotalMs = ms;
      continue;
    }

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

  if (runLaps.length === 8) out.runs = runLaps;
  if (out.runTotalMs == null && runLaps.length === 8)
    out.runTotalMs = runLaps.reduce((a, b) => a + b, 0);

  // 총 기록을 못 찾았으면 텍스트 내 최대 h:mm:ss 값으로 추정.
  // 단, 결과 페이지에는 시각(예: 19:34:40)도 섞여 있으므로
  // 현실적인 완주 시간 범위(6시간 이하)만 후보로 삼는다.
  if (out.totalMs == null) {
    let max = 0;
    for (const m of text.matchAll(new RegExp(TIME_RE.source, "g"))) {
      if (m[3] != null && Number(m[1]) <= 6) max = Math.max(max, timeTokenToMs(m));
    }
    if (max > 0) out.totalMs = max;
  }

  return out;
}

/**
 * Race Replay 표 → 24구간.
 *
 * 공식 상세 페이지의 리플레이 표는 체크포인트마다
 * <th class="desc">라벨</th><td class="time_day">시각</td>
 * <td class="time">누적</td><td class="diff …">구간</td> 행을 가진다.
 * 라벨 패턴 (스테이션 1~7):
 *   "Rox In"(구간=직전 런) → "<종목> In"(=존 진입 전환) →
 *   "<종목> Out"(=스테이션 수행) → "Rox Out"(=존 이탈 전환)
 * 마지막 스테이션(월볼)은 Rox In 없이 "… In"(구간=런8)으로 바로 진입하고
 * "Total" 행의 구간이 월볼 수행 시간이다.
 * 구간값은 누적(time) 열의 차분으로 계산해 합계가 총 기록과 정확히 일치하게 한다.
 */
export function parseRaceReplay(html: string): {
  segments: RaceSegment[];
  runs: number[];
  roxzones: number[];
  startClock?: string;
  totalMs: number;
} | null {
  const src = html.replace(/\s+/g, " ");
  const rowRe =
    /<th class="desc"[^>]*>([^<]+)<\/th>\s*<td class="time_day">([^<]*)<\/td>\s*<td class="time">([^<]*)<\/td>\s*<td class="diff[^"]*">([^<]*)<\/td>/g;

  type Checkpoint = { label: string; clock: string; cumMs: number };
  const cps: Checkpoint[] = [];
  for (const m of src.matchAll(rowRe)) {
    const cum = m[3].match(TIME_RE);
    if (!cum) continue;
    cps.push({
      label: m[1].trim(),
      clock: m[2].trim(),
      cumMs: timeTokenToMs(cum),
    });
  }
  if (cps.length < 10) return null;

  const segments: RaceSegment[] = [];
  let prevCum = 0;
  let runN = 0;
  let curRox: RaceSegment | null = null;
  let pendingStationKey: string | null = null;

  const stationOf = (label: string): string | null =>
    STATION_KEYWORDS.find(([, re]) => re.test(label))?.[0] ?? null;

  const startRun = (splitMs: number): RaceSegment => {
    runN += 1;
    segments.push({ kind: "run", stationKey: null, n: runN, splitMs });
    const rox: RaceSegment = {
      kind: "roxzone",
      stationKey: null,
      n: runN,
      splitMs: 0,
    };
    segments.push(rox);
    return rox;
  };

  for (const cp of cps) {
    const seg = cp.cumMs - prevCum;
    prevCum = cp.cumMs;
    if (seg < 0) return null; // 누적이 역행하면 구조 가정이 깨진 것

    const key = stationOf(cp.label);
    if (/^rox(?:zone)?\s*in$/i.test(cp.label)) {
      curRox = startRun(seg);
    } else if (key && /\bin$/i.test(cp.label)) {
      if (curRox && segments[segments.length - 1] === curRox) {
        curRox.splitMs += seg; // 존 진입 전환
      } else {
        curRox = startRun(seg); // 월볼: Rox In 없이 런에서 바로 진입
      }
      pendingStationKey = key;
    } else if (key && /\bout$/i.test(cp.label)) {
      segments.push({ kind: "station", stationKey: key, n: runN, splitMs: seg });
      pendingStationKey = null;
    } else if (/^rox(?:zone)?\s*out$/i.test(cp.label)) {
      if (curRox) curRox.splitMs += seg; // 존 이탈 전환
    } else if (/total|finish/i.test(cp.label)) {
      if (pendingStationKey) {
        segments.push({
          kind: "station",
          stationKey: pendingStationKey,
          n: runN,
          splitMs: seg,
        });
        pendingStationKey = null;
      }
    }
    // 그 외 라벨(예상 밖 체크포인트)은 무시 — 아래 검증에서 걸러짐
  }

  // 검증: 런 8 + 스테이션 8(서로 다른 종목)이어야 신뢰
  const stationKeys = segments
    .filter((s) => s.kind === "station")
    .map((s) => s.stationKey);
  if (runN !== 8 || stationKeys.length !== 8) return null;
  if (new Set(stationKeys).size !== 8) return null;

  // 출발 시각 = 첫 체크포인트 시각 − 그 누적 시간
  let startClock: string | undefined;
  const clockM = cps[0].clock.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (clockM) {
    let s =
      Number(clockM[1]) * 3600 +
      Number(clockM[2]) * 60 +
      Number(clockM[3]) -
      Math.round(cps[0].cumMs / 1000);
    if (s < 0) s += 24 * 3600;
    const pad = (v: number) => String(v).padStart(2, "0");
    startClock = `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  }

  return {
    segments,
    runs: segments.filter((s) => s.kind === "run").map((s) => s.splitMs),
    roxzones: segments.filter((s) => s.kind === "roxzone").map((s) => s.splitMs),
    startClock,
    totalMs: cps[cps.length - 1].cumMs,
  };
}

/** 상세 페이지 HTML 통합 파싱: 스플릿 표(텍스트) + Race Replay(구조) */
export function parseRaceHtml(html: string): ParsedRace {
  const out = parseRaceText(htmlToText(html));
  const replay = parseRaceReplay(html);
  if (replay) {
    out.segments = replay.segments;
    out.runs = replay.runs;
    out.roxzones = replay.roxzones;
    out.startClock = replay.startClock;
    if (out.totalMs == null) out.totalMs = replay.totalMs;
    if (out.runTotalMs == null)
      out.runTotalMs = replay.runs.reduce((a, b) => a + b, 0);
    if (out.roxzoneTotalMs == null)
      out.roxzoneTotalMs = replay.roxzones.reduce((a, b) => a + b, 0);
    // 스플릿 표에서 놓친 스테이션은 리플레이 값으로 보충
    for (const s of replay.segments)
      if (s.kind === "station" && s.stationKey && out.stations[s.stationKey] == null)
        out.stations[s.stationKey] = s.splitMs;
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
