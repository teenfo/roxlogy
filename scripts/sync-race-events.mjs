// 대회 일정 자동 동기화 — race_events 멱등 upsert (name+season 충돌 키).
//
// 소스 우선순위:
//   1) HYROX_RESULT_API_TOKEN 이 있으면 hyroxresultapi.com (구독형 Result API)
//   2) HYROX_EVENTS_API_URL 이 있으면 그 JSON (제네릭 피드 어댑터)
//   3) 없으면 supabase/data/race-events.json (큐레이션 폴백)
//
// SYNC_DRY_RUN=1 이면 매핑 결과만 로그로 출력하고 DB 에 쓰지 않는다 —
// 신규 소스의 응답 구조를 확인·검증하는 용도 (workflow_dispatch dry_run 입력).
//
// 병합 규칙 (2026-09-10 정교화):
//   · 같은 대회 = (도시, 시즌). 예전엔 (도시, 시작일 ±7일)이라 큐레이션의 조사 시점
//     날짜가 실측과 7일 넘게 어긋나면 별개 대회로 갈라져 중복이 생겼다("Perth 6월").
//   · 양쪽에 있으면 한 행으로 합친다 — 이름·장소·URL 은 큐레이션(스폰서 표기가
//     정확), 날짜는 API 실측. 한 시즌에 같은 도시가 두 번이면 시작일이 가장 가까운
//     API 회차와 짝짓는다.
//   · 시즌은 API 시즌 id → 큐레이션 명시값 → 시즌 카탈로그 날짜 범위 → 7월 경계
//     순으로 정한다. 6월 대회는 시즌 경계에 걸려 있어 큐레이션에 시즌을 꼭 적을 것.
//   · end_date 가 비면 start_date 로 채운다(1일 대회). 웹은 end_date 로 지난 대회를
//     가르므로 비워 두면 영원히 "다가오는" 쪽에 남는다.
//   · 소스에 더는 없는 행은 지운다 — 단 "완전성이 입증된 시즌"(completeSeasons)
//     안에서만. 시즌이 완전하다 = Result API 의 그 시즌 페이지를 meta.last_page 까지
//     다 받았고, 빈 응답이 아니며, 회차 수가 DB 의 API 실측 행(api_city 있음) 대비
//     절반 아래로 줄지 않았을 때. 큐레이션·제네릭 피드만으로는 어떤 시즌도 완전하지
//     않다. 크루 일정·내 대회 계획이 참조하는 행은 남기고, 한 번에 10행 넘게 지우게
//     되면 데이터 사고로 보고 중단한다. 지우기 전에 대상 행 전체를 JSON 으로 로그에
//     남긴다(복구용). (2026-09-11 감사 A08 — 예전엔 병합 결과에 나온 시즌 전체를
//     정리 범위로 잡아, 큐레이션에 섞인 과거 시즌의 API 전용 행이 orphan 으로 보일 수
//     있었고 20페이지 상한·빈 응답도 "완전"으로 쳤다.)
//
// 보안: 토큰·서비스 키는 CI 시크릿(서버 전용). 클라이언트 노출 금지.
// 실행: node scripts/sync-race-events.mjs   (Node 20+ — 내장 fetch 사용)

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PROJECT_URL = "https://vuloxbpfhyqkvgmpmkst.supabase.co";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const API_URL = process.env.HYROX_EVENTS_API_URL || null;
const RESULT_API_TOKEN = process.env.HYROX_RESULT_API_TOKEN || null;
const RESULT_API_BASE =
  process.env.HYROX_RESULT_API_BASE || "https://hyroxresultapi.com/api/v1";
const DRY_RUN = process.env.SYNC_DRY_RUN === "1";

const REGIONS = new Set([
  "asia",
  "europe",
  "north_america",
  "south_america",
  "africa",
  "oceania",
]);

// ── 한국어 표기 맵 (모르면 원문 유지) ─────────────────────────────────────────

const CITY_KO = {
  seoul: "서울", incheon: "인천", "hong kong": "홍콩", osaka: "오사카",
  tokyo: "도쿄", chiba: "지바", bangkok: "방콕", taipei: "타이베이",
  singapore: "싱가포르", mumbai: "뭄바이", jakarta: "자카르타",
  beijing: "베이징", shanghai: "상하이", shenzhen: "선전",
  guangzhou: "광저우", chengdu: "청두", hangzhou: "항저우",
  london: "런던", manchester: "맨체스터", birmingham: "버밍엄",
  glasgow: "글래스고", dublin: "더블린", paris: "파리", hamburg: "함부르크",
  berlin: "베를린", frankfurt: "프랑크푸르트", cologne: "쾰른",
  munich: "뮌헨", stuttgart: "슈투트가르트", vienna: "빈",
  amsterdam: "암스테르담", rotterdam: "로테르담", maastricht: "마스트리흐트",
  madrid: "마드리드", barcelona: "바르셀로나", valencia: "발렌시아",
  milan: "밀라노", rome: "로마", turin: "토리노", copenhagen: "코펜하겐",
  stockholm: "스톡홀름", oslo: "오슬로", helsinki: "헬싱키",
  warsaw: "바르샤바", prague: "프라하", zurich: "취리히", geneva: "제네바",
  lisbon: "리스본", porto: "포르투", athens: "아테네", istanbul: "이스탄불",
  dubai: "두바이", "abu dhabi": "아부다비", doha: "도하", riyadh: "리야드",
  "new york": "뉴욕", chicago: "시카고", "los angeles": "로스앤젤레스",
  anaheim: "애너하임", "las vegas": "라스베이거스", dallas: "댈러스",
  houston: "휴스턴", miami: "마이애미", atlanta: "애틀랜타",
  "washington dc": "워싱턴 DC", "washington d.c.": "워싱턴 DC",
  boston: "보스턴", phoenix: "피닉스", denver: "덴버", seattle: "시애틀",
  "salt lake city": "솔트레이크시티", toronto: "토론토", vancouver: "밴쿠버",
  montreal: "몬트리올", "mexico city": "멕시코시티",
  "sao paulo": "상파울루", "são paulo": "상파울루",
  "rio de janeiro": "리우데자네이루", "buenos aires": "부에노스아이레스",
  santiago: "산티아고", bogota: "보고타", "bogotá": "보고타",
  sydney: "시드니", melbourne: "멜버른", brisbane: "브리즈번", perth: "퍼스",
  auckland: "오클랜드", "cape town": "케이프타운",
  johannesburg: "요하네스버그", cairo: "카이로", delhi: "델리",
  mechelen: "메헬렌", karlsruhe: "카를스루에", gdansk: "그단스크",
  bilbao: "빌바오", marseille: "마르세유", bordeaux: "보르도",
  nice: "니스", leipzig: "라이프치히", hannover: "하노버",
  essen: "에센", dortmund: "도르트문트", katowice: "카토비체",
};

const COUNTRY_KO = {
  germany: "독일", "united kingdom": "영국", uk: "영국", france: "프랑스",
  netherlands: "네덜란드", spain: "스페인", italy: "이탈리아",
  austria: "오스트리아", switzerland: "스위스", poland: "폴란드",
  "czech republic": "체코", czechia: "체코", portugal: "포르투갈",
  ireland: "아일랜드", denmark: "덴마크", sweden: "스웨덴",
  norway: "노르웨이", finland: "핀란드", greece: "그리스",
  turkey: "튀르키예", "türkiye": "튀르키예",
  usa: "미국", "united states": "미국", "united states of america": "미국",
  canada: "캐나다", mexico: "멕시코", brazil: "브라질",
  argentina: "아르헨티나", chile: "칠레", colombia: "콜롬비아",
  "south korea": "대한민국", korea: "대한민국",
  "korea, republic of": "대한민국", japan: "일본", china: "중국",
  "hong kong": "홍콩", taiwan: "대만", thailand: "태국",
  singapore: "싱가포르", malaysia: "말레이시아", indonesia: "인도네시아",
  india: "인도", philippines: "필리핀", vietnam: "베트남",
  "united arab emirates": "아랍에미리트", uae: "아랍에미리트",
  qatar: "카타르", "saudi arabia": "사우디아라비아", australia: "호주",
  "new zealand": "뉴질랜드", "south africa": "남아프리카공화국",
  egypt: "이집트",
};

const REGION_BY_COUNTRY_KO = {
  대한민국: "asia", 일본: "asia", 중국: "asia", 홍콩: "asia", 대만: "asia",
  태국: "asia", 싱가포르: "asia", 말레이시아: "asia", 인도네시아: "asia",
  인도: "asia", 필리핀: "asia", 베트남: "asia", 아랍에미리트: "asia",
  카타르: "asia", 사우디아라비아: "asia",
  독일: "europe", 영국: "europe", 프랑스: "europe", 네덜란드: "europe",
  스페인: "europe", 이탈리아: "europe", 오스트리아: "europe",
  스위스: "europe", 폴란드: "europe", 체코: "europe", 포르투갈: "europe",
  아일랜드: "europe", 덴마크: "europe", 스웨덴: "europe", 노르웨이: "europe",
  핀란드: "europe", 그리스: "europe", 튀르키예: "europe",
  미국: "north_america", 캐나다: "north_america", 멕시코: "north_america",
  브라질: "south_america", 아르헨티나: "south_america",
  칠레: "south_america", 콜롬비아: "south_america",
  호주: "oceania", 뉴질랜드: "oceania",
  남아프리카공화국: "africa", 이집트: "africa",
};

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

/** 여러 후보 키(점 표기 가능) 중 첫 유효값 */
function pick(obj, keys) {
  for (const k of keys) {
    const v = k.split(".").reduce((o, p) => (o == null ? o : o[p]), obj);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

/** ISO 문자열/타임스탬프 → YYYY-MM-DD (실패 시 null) */
function toDate(v) {
  if (!v) return null;
  const s = String(v);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** 시즌 카탈로그의 날짜 범위 (API 가 주면). fetchSeasonMap 이 채운다. */
let SEASON_RANGES = []; // [{label, start, end}]

/** 날짜 → 시즌 라벨. 카탈로그 범위가 있으면 그것으로, 없으면 7월 경계.
 *  (6월은 경계에 걸린다 — S8 마지막 대회와 S9 개막 대회가 같은 달에 있다.
 *   예전 6월 경계는 S8 6월 대회(부에노스아이레스 6/13)를 S9 로 붙였다.) */
function seasonForDate(startDate) {
  if (!startDate) return null;
  const hit = SEASON_RANGES.find(
    (r) => r.start && r.end && startDate >= r.start && startDate <= r.end,
  );
  if (hit) return hit.label;
  const y = Number(startDate.slice(0, 4));
  const m = Number(startDate.slice(5, 7));
  const y1 = m >= 7 ? y : y - 1;
  return `S${y1 - 2017} ${y1}/${String(y1 + 1).slice(-2)}`; // S8=2025/26 기준
}

/** 시즌 표기 정규화 → 'S9 2026/27'. 실패 시 시작일로 유추 (seasonForDate). */
function normalizeSeason(rawSeason, startDate) {
  const s = rawSeason == null ? "" : String(rawSeason);
  const years = s.match(/(\d{4})\s*[\/–-]\s*(\d{2,4})/);
  const num = s.match(/(?:season\s*|s)(\d{1,2})/i);
  if (years) {
    const y1 = Number(years[1]);
    const y2s = String(years[2]).slice(-2);
    const n = num ? Number(num[1]) : y1 - 2017; // S8=2025/26 기준
    return `S${n} ${y1}/${y2s}`;
  }
  if (num && startDate) {
    // 시즌 번호는 믿고 연도만 날짜로 정한다
    const guess = seasonForDate(startDate);
    return guess ? `S${num[1]} ${guess.slice(guess.indexOf(" ") + 1)}` : null;
  }
  if (startDate) return seasonForDate(startDate);
  return s || null;
}

// ISO 3166-1 alpha-2 → 한국어 국가명 (모르면 코드 유지)
const ISO2_KO = {
  KR: "대한민국", JP: "일본", CN: "중국", HK: "홍콩", TW: "대만",
  TH: "태국", SG: "싱가포르", MY: "말레이시아", ID: "인도네시아",
  IN: "인도", PH: "필리핀", VN: "베트남", AE: "아랍에미리트",
  QA: "카타르", SA: "사우디아라비아", KW: "쿠웨이트",
  DE: "독일", GB: "영국", FR: "프랑스", NL: "네덜란드", ES: "스페인",
  IT: "이탈리아", AT: "오스트리아", CH: "스위스", PL: "폴란드",
  CZ: "체코", PT: "포르투갈", IE: "아일랜드", DK: "덴마크",
  SE: "스웨덴", NO: "노르웨이", FI: "핀란드", GR: "그리스",
  TR: "튀르키예", BE: "벨기에", HU: "헝가리", RO: "루마니아",
  US: "미국", CA: "캐나다", MX: "멕시코",
  BR: "브라질", AR: "아르헨티나", CL: "칠레", CO: "콜롬비아",
  AU: "호주", NZ: "뉴질랜드", ZA: "남아프리카공화국", EG: "이집트",
};
// 큐레이션 JSON 은 한국어 도시·국가만 갖고 있다. i18n 컬럼(city_en·country_code)을
// 채우려면 역방향 조회가 필요하다 — 없으면 null 로 두고 화면은 ko 값으로 폴백한다.
const KO_CITY_EN = Object.fromEntries(
  Object.entries(CITY_KO).map(([en, ko]) => [
    ko,
    en.replace(/\b\w/g, (c) => c.toUpperCase()),
  ]),
);
const KO_ISO2 = Object.fromEntries(
  Object.entries(ISO2_KO).map(([iso, ko]) => [ko, iso]),
);

const REGION_BY_ISO2 = {
  KR: "asia", JP: "asia", CN: "asia", HK: "asia", TW: "asia", TH: "asia",
  SG: "asia", MY: "asia", ID: "asia", IN: "asia", PH: "asia", VN: "asia",
  AE: "asia", QA: "asia", SA: "asia", KW: "asia",
  DE: "europe", GB: "europe", FR: "europe", NL: "europe", ES: "europe",
  IT: "europe", AT: "europe", CH: "europe", PL: "europe", CZ: "europe",
  PT: "europe", IE: "europe", DK: "europe", SE: "europe", NO: "europe",
  FI: "europe", GR: "europe", TR: "europe", BE: "europe", HU: "europe",
  RO: "europe",
  US: "north_america", CA: "north_america", MX: "north_america",
  BR: "south_america", AR: "south_america", CL: "south_america",
  CO: "south_america",
  AU: "oceania", NZ: "oceania",
  ZA: "africa", EG: "africa",
};

/** "2026 Perth" → "Perth" (연도 프리픽스 제거) */
function stripYear(city) {
  return String(city ?? "").replace(/^\s*(19|20)\d{2}\s+/, "").trim();
}

/** Result API 이벤트(디비전×요일 단위) → 대회 주말 단위로 집계해 race_events 행 생성.
 *  같은 (도시, 시작일) 묶음 = 한 대회. 한 시즌에 같은 도시 2회면 뒤 회차 이름에 월을 붙여
 *  (name, season) 유니크 키를 지킨다. */
function aggregateResultApi(rawRows, seasonLabelById) {
  const groups = new Map();
  for (const raw of rawRows) {
    const cityRaw = stripYear(raw.city);
    const start = toDate(raw.start_date);
    if (!cityRaw || !start) continue;
    const key = `${cityRaw.toLowerCase()}|${start}`;
    const g = groups.get(key) ?? {
      cityRaw,
      countryCode: String(raw.country_code ?? "").toUpperCase(),
      seasonId: raw.season_id ?? null,
      start,
      end: toDate(raw.end_date) ?? start,
    };
    const end = toDate(raw.end_date);
    if (end && end > g.end) g.end = end;
    groups.set(key, g);
  }

  // 시즌 내 같은 도시 중복 → 시작일 순으로 두 번째부터 "N월" 접미
  const byCitySeason = new Map();
  for (const g of groups.values()) {
    const k = `${g.cityRaw.toLowerCase()}|${g.seasonId}`;
    const arr = byCitySeason.get(k) ?? [];
    arr.push(g);
    byCitySeason.set(k, arr);
  }

  const rows = [];
  for (const arr of byCitySeason.values()) {
    arr.sort((a, b) => a.start.localeCompare(b.start));
    arr.forEach((g, i) => {
      const cityKo = CITY_KO[g.cityRaw.toLowerCase()] ?? g.cityRaw;
      const month = Number(g.start.slice(5, 7));
      const name =
        i === 0 ? `HYROX ${g.cityRaw}` : `HYROX ${g.cityRaw} ${month}월`;
      rows.push({
        name,
        city: cityKo,
        city_en: g.cityRaw, // en/es 화면 표기 (ko 는 city)
        api_city: g.cityRaw, // 상세 페이지의 API 이벤트 매칭용 (영문 원문)
        country: ISO2_KO[g.countryCode] ?? g.countryCode,
        country_code: g.countryCode || null, // 화면은 country.<ISO2> 사전으로 번역
        region: REGION_BY_ISO2[g.countryCode] ?? null,
        venue: null,
        start_date: g.start,
        end_date: g.end,
        date_note: null,
        season: seasonLabelById.get(g.seasonId) ?? normalizeSeason(null, g.start),
        official_url: "https://hyrox.com/find-my-race/",
      });
    });
  }
  return rows;
}

/** 드라이런 프로브 — OpenAPI 스펙과 주요 엔드포인트 샘플을 로그로 덤프.
 *  일정 외 기능(벤치마크·대회 통계·개인 스플릿) 구현의 근거 자료. */
async function probeResultApi() {
  const headers = {
    authorization: `Bearer ${RESULT_API_TOKEN}`,
    accept: "application/json",
  };
  try {
    const res = await fetch(`${RESULT_API_BASE}/openapi.yaml`, {
      headers: { accept: "text/yaml, application/yaml, */*" },
    });
    if (res.ok) {
      const text = await res.text();
      console.log("── openapi.yaml (스펙 전문, 60KB 컷) ──");
      console.log(text.slice(0, 60000));
    } else {
      console.log(`openapi.yaml: ${res.status}`);
    }
  } catch (e) {
    console.log(`openapi.yaml fetch 실패: ${e.message}`);
  }
  // 통계·벤치마크 페이로드 구조 확인 — 결과가 있는 이벤트 하나로 샘플링
  try {
    const ev = await apiGet(`${RESULT_API_BASE}/events?season=season-9&per_page=5`);
    const first = (ev.data ?? []).find((e) => (e.results_count ?? 0) > 0);
    if (first) {
      console.log(`── 프로브 이벤트: id=${first.id} ${first.name} @ ${first.city} ──`);
      for (const p of [
        `/stats/divisions/${first.id}`,
        `/events/${first.slug}/ingest-status`,
      ]) {
        try {
          const res = await fetch(`${RESULT_API_BASE}${p}`, { headers });
          const body = await res.text();
          console.log(`── GET ${p} → ${res.status} ──`);
          console.log(body.slice(0, 6000));
        } catch (e) {
          console.log(`GET ${p} 실패: ${e.message}`);
        }
      }
    }
    for (const dg of ["HYROX_MEN", "HYROX_WOMEN"]) {
      try {
        const res = await fetch(
          `${RESULT_API_BASE}/simulator/division-benchmarks?dg=${dg}`,
          { headers },
        );
        const body = await res.text();
        console.log(`── GET /simulator/division-benchmarks?dg=${dg} → ${res.status} ──`);
        console.log(body.slice(0, 4000));
      } catch (e) {
        console.log(`benchmarks ${dg} 실패: ${e.message}`);
      }
    }
  } catch (e) {
    console.log(`stats 프로브 실패: ${e.message}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 인증 GET + 레이트리밋 대응 — Starter 분당 30요청: 호출 간 2.2초 간격,
 *  429 는 Retry-After 만큼 대기 후 재시도 (최대 3회). */
let lastCallAt = 0;
async function apiGet(url) {
  const headers = {
    authorization: `Bearer ${RESULT_API_TOKEN}`,
    accept: "application/json",
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = lastCallAt + 2200 - Date.now();
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
    const res = await fetch(url, { headers });
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after")) || 30;
      console.log(`429 — ${retryAfter}s 대기 후 재시도 (${url})`);
      await sleep(retryAfter * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`result api ${res.status} ${res.statusText} (${url})`);
    return res.json();
  }
  throw new Error(`result api rate-limited repeatedly (${url})`);
}

/** 시즌 카탈로그 → id → 'S9 2026/27' 표기 맵 + 현재·직전 시즌 슬러그.
 *  카탈로그에 시작·종료일이 있으면 SEASON_RANGES 에 담아 시즌 유추에 쓴다
 *  (필드명은 스펙마다 달라 후보를 넓게 본다 — 없으면 7월 경계 폴백). */
async function fetchSeasonMap() {
  const json = await apiGet(`${RESULT_API_BASE}/seasons?per_page=50`);
  const map = new Map();
  const labelBySlug = new Map(); // 시즌 슬러그 → 라벨 (완전성 집합은 라벨 기준)
  const bySlugN = [];
  for (const s of json.data ?? []) {
    const n = Number(String(s.slug ?? "").match(/season-(\d+)/)?.[1] ?? NaN);
    const yy = String(s.label ?? "").match(/(\d{2})\s*\/\s*(\d{2})/);
    if (!Number.isFinite(n) || !yy) continue;
    const label = `S${n} 20${yy[1]}/${yy[2]}`;
    map.set(s.id, label);
    labelBySlug.set(s.slug, label);
    bySlugN.push({ n, slug: s.slug });
    const start = toDate(pick(s, ["start_date", "starts_at", "from", "date_from", "begin"]));
    const end = toDate(pick(s, ["end_date", "ends_at", "to", "date_to", "finish"]));
    if (start && end) SEASON_RANGES.push({ label, start, end });
  }
  bySlugN.sort((a, b) => b.n - a.n);
  return {
    map,
    labelBySlug,
    currentSlug: bySlugN[0]?.slug ?? null,
    previousSlug: bySlugN[1]?.slug ?? null,
  };
}

const MAX_PAGES = 20;

/** 시즌 이벤트 수집 → { rows, complete, reason, weekends }.
 *  complete 는 orphan 삭제의 유일한 근거라 보수적으로 판정한다 — 아래 하나라도 걸리면 false:
 *   · meta.last_page 에 도달하지 못함 (MAX_PAGES 상한에 걸렸거나, meta 가 없거나,
 *     그 전에 빈 페이지가 와서 끊김). 상한에 걸린 채 "끝"으로 치면 뒷 페이지 회차가
 *     전부 orphan 으로 보인다.
 *   · 응답이 비어 있음 — API 가 200 + [] 를 돌려주는 장애를 정상으로 보면 시즌 전체가
 *     삭제 후보가 된다(10건 상한이 막아도 1~10건은 지워진다).
 *   · 회차(도시×시작일) 수가 baselineWeekends 의 절반 아래 — 직전 실행까지 DB 에 쌓인
 *     API 실측 행 대비 급감은 부분 응답으로 본다. 기준값이 null/0 이면 검사 생략.
 *   · fromDate 로 범위를 잘라 받음 (부분 범위는 정의상 불완전).
 *  incomplete 여도 rows 는 그대로 돌려준다 — upsert 는 해도 되고 삭제만 하면 안 된다. */
async function fetchResultApiEvents(
  seasonSlug,
  { fromDate = null, baselineWeekends = null } = {},
) {
  const rows = [];
  let reachedLast = false;
  let emptyPageAt = null;
  let pages = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url =
      `${RESULT_API_BASE}/events?season=${encodeURIComponent(seasonSlug)}` +
      (fromDate ? `&from=${fromDate}` : "") +
      `&per_page=100&page=${page}`;
    const json = await apiGet(url);
    const arr = json.data ?? [];
    pages = page;
    if (page === 1) {
      console.log("── result api raw sample (매핑 검증용) ──");
      console.log(JSON.stringify(arr.slice(0, 2), null, 2));
    }
    if (!arr.length) {
      emptyPageAt = page;
      break;
    }
    rows.push(...arr);
    const last = json.meta?.last_page ?? null;
    if (last != null && page >= Number(last)) {
      reachedLast = true;
      break;
    }
  }
  // 회차 수는 aggregateResultApi 와 같은 (도시, 시작일) 묶음으로 센다 — 디비전×요일
  // 행 수는 회차당 여러 개라 DB 행 수와 비교할 수 없다.
  const weekendKeys = new Set();
  for (const r of rows) {
    const city = stripYear(r.city).toLowerCase();
    const start = toDate(r.start_date);
    if (city && start) weekendKeys.add(`${city}|${start}`);
  }
  const weekends = weekendKeys.size;
  let reason = null;
  if (fromDate) reason = `from=${fromDate} 부분 범위`;
  else if (!rows.length) reason = "빈 응답";
  else if (!reachedLast) {
    reason =
      emptyPageAt != null
        ? `${emptyPageAt}페이지가 비어 meta.last_page 전에 끊김`
        : `${MAX_PAGES}페이지 상한 도달 (meta.last_page 미도달)`;
  } else if (baselineWeekends && weekends < baselineWeekends * 0.5) {
    reason = `회차 급감 (${weekends} < DB API 실측 ${baselineWeekends}행의 50%)`;
  }
  const complete = reason == null;
  console.log(
    `result api ${seasonSlug}: ${rows.length} division-rows · ${weekends} weekends · ${pages} page(s) · ` +
      (complete ? "complete" : `incomplete — ${reason}`) +
      (baselineWeekends ? "" : " · 급감 검사 생략(DB 기준값 없음)"),
  );
  return { rows, complete, reason, weekends };
}

/** 소스 레코드(제네릭/큐레이션) → race_events 행으로 정규화 + 검증 */
function normalize(raw) {
  const city = (raw.city ?? "").toString().trim();
  const country = (raw.country ?? "").toString().trim();
  const row = {
    name: (raw.name ?? "").toString().trim(),
    city,
    // PostgREST 벌크 upsert 는 모든 객체의 키 집합이 같아야 한다(PGRST102).
    // aggregateResultApi 가 내보내는 키와 반드시 일치시킬 것.
    city_en: raw.city_en ?? raw.api_city ?? KO_CITY_EN[city] ?? null,
    api_city: raw.api_city ?? null,
    country,
    country_code: raw.country_code ?? KO_ISO2[country] ?? null,
    region: raw.region ?? null,
    venue: raw.venue ?? null,
    start_date: raw.start_date ?? null,
    end_date: raw.end_date ?? null,
    date_note: raw.date_note ?? null,
    season: raw.season ?? null,
    official_url: raw.official_url ?? "https://hyrox.com/find-my-race/",
  };
  if (!row.name || !row.city || !row.country) return null; // 필수 결측 → 스킵
  if (row.region && !REGIONS.has(row.region)) row.region = null;
  fixDates(row);
  if (!row.season && row.start_date) row.season = seasonForDate(row.start_date);
  return row;
}

/** end 가 비면 start 로(1일 대회), 뒤집혀 있으면 start 로 맞춘다 */
function fixDates(row) {
  if (row.start_date && !row.end_date) row.end_date = row.start_date;
  if (row.start_date && row.end_date && row.end_date < row.start_date) {
    row.end_date = row.start_date;
  }
  return row;
}

/** 병합 키: 같은 도시 = 같은 대회 (스폰서 접두·연도 접두·언어 차이를 무시) */
function cityKey(row) {
  const en = row.api_city ?? row.city_en ?? KO_CITY_EN[row.city] ?? row.city;
  return stripYear(en).toLowerCase().replace(/\s+/g, " ").trim();
}

async function loadCurated() {
  const here = dirname(fileURLToPath(import.meta.url));
  const file = join(here, "..", "supabase", "data", "race-events.json");
  const rows = JSON.parse(await readFile(file, "utf8"));
  return rows.map(normalize).filter(Boolean);
}

async function loadSource() {
  if (RESULT_API_TOKEN) {
    // Result API 는 결과가 수집된(=이미 열린) 대회만 갖고 있다 — 미래 일정은
    // 큐레이션 JSON 이 소스. 둘을 병합하되, 같은 대회(도시 동일 + 시작일 ±7일)가
    // 양쪽에 있으면 이름 표기가 정확한 큐레이션 행을 우선한다.
    // 현재 시즌 + 직전 시즌을 통째로 받는다(시즌 말·개막이 겹치는 6~7월 대비).
    const { map: seasonMap, labelBySlug, currentSlug, previousSlug } =
      await fetchSeasonMap();
    if (!currentSlug) throw new Error("season catalog empty");
    const slugs = [previousSlug, currentSlug].filter(Boolean);
    // 급감 판정 기준값 = 직전 실행까지 DB 에 쌓인 그 시즌의 API 실측 행 수(api_city 있음).
    // 시즌 전체 행 수를 쓰면 안 된다 — 시즌 초반엔 큐레이션(미래 일정)이 대부분이라
    // API 회차가 늘 절반 아래로 보여 정리가 영영 안 돈다(2026-09-11 S9: 31행 중 API 15행).
    // 서비스 키가 없는 드라이런은 기준값 없이 돌고, 그땐 급감 검사만 생략된다.
    const baseline = SERVICE_ROLE
      ? await countApiBackedBySeason(slugs.map((s) => labelBySlug.get(s)).filter(Boolean))
      : null;
    if (!baseline) console.log("급감 검사: SERVICE_ROLE 없음 → 생략");
    const raw = [];
    const completeSeasons = new Set(); // 라벨 기준 — orphan 정리는 이 안에서만
    for (const slug of slugs) {
      const label = labelBySlug.get(slug) ?? null;
      const r = await fetchResultApiEvents(slug, {
        baselineWeekends: label && baseline ? (baseline.get(label) ?? 0) : null,
      });
      raw.push(...r.rows);
      // 라벨을 모르는 슬러그는 어느 시즌이 완전한지 말할 수 없으니 집합에 넣지 않는다
      if (r.complete && label) completeSeasons.add(label);
    }
    const apiRows = aggregateResultApi(raw, seasonMap).map(fixDates);
    const curated = await loadCurated();

    // (도시, 시즌) → API 회차들 (시작일 순)
    const apiByCS = new Map();
    for (const r of apiRows) {
      const k = `${cityKey(r)}|${r.season}`;
      const arr = apiByCS.get(k) ?? [];
      arr.push(r);
      apiByCS.set(k, arr);
    }
    for (const arr of apiByCS.values()) arr.sort((a, b) => a.start_date.localeCompare(b.start_date));

    const days = (a, b) =>
      Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);
    // 같은 회차로 볼 최대 날짜 차. 큐레이션은 조사 시점 예정일이라 몇 주 어긋날 수
    // 있지만, 그 이상이면 같은 시즌에 같은 도시가 두 번 여는 것이다 — 방콕은
    // 2026-08 과 2027-02 에 한 번씩. 캡 없이 "가장 가까운" 회차와 짝지으면 2027년
    // 2월 대회가 8월 실측 날짜를 덮어써 지난 대회가 돼 버렸다(2026-09-10 실제 사고).
    const PAIR_MAX_DAYS = 45;
    const used = new Set(); // 큐레이션과 짝지어진 API 행
    const merged = [];
    let paired = 0;
    for (const c of curated) {
      const cands = apiByCS.get(`${cityKey(c)}|${c.season}`) ?? [];
      // 큐레이션에 날짜가 있으면 45일 안의 가장 가까운 회차만, 날짜가 없으면
      // 아직 안 열린 회차(첫 미사용)와 짝짓는다.
      const free = cands.filter((r) => !used.has(r));
      let best = null;
      if (free.length && c.start_date) {
        const nearest = free.reduce((m, r) =>
          days(r.start_date, c.start_date) < days(m.start_date, c.start_date) ? r : m,
        );
        if (days(nearest.start_date, c.start_date) <= PAIR_MAX_DAYS) best = nearest;
      } else if (free.length) {
        best = free[0];
      }
      if (!best) {
        merged.push(c); // 아직 API 에 없는 미래 대회 — 큐레이션 그대로
        continue;
      }
      used.add(best);
      paired++;
      merged.push({
        ...best,
        // 이름·장소·URL·비고는 큐레이션이 정확하다(스폰서 표기, 실제 장소)
        name: c.name,
        venue: c.venue ?? best.venue,
        official_url: c.official_url ?? best.official_url,
        date_note: null, // 실측 날짜가 있으니 예정 비고는 지운다
      });
    }
    // (name, season) 은 유니크. 큐레이션이 먼저 자리를 잡고, 짝지어지지 않은 API 회차가
    // 같은 키를 쓰면(API 는 시즌 첫 회차를 "HYROX {City}" 로 부른다) 큐레이션을 덮어쓰지
    // 않고 API 쪽 이름에 월·일을 붙여 비켜 간다 — 베이징: 큐레이션 9월 회차가 API 6월
    // 회차에 지워진 적이 있다(2026-09-10).
    const byKey = new Map();
    for (const r of merged) byKey.set(`${r.name}|${r.season}`, r);
    let collided = 0;
    const apiUnpaired = apiRows.filter((r) => !used.has(r));
    for (const r of apiUnpaired) {
      let name = r.name;
      if (byKey.has(`${name}|${r.season}`)) {
        collided++;
        const [y, m, d] = r.start_date.split("-").map(Number);
        const base = name.replace(/\s+\d{1,2}월$/, "");
        name = `${base} ${m}월`;
        if (byKey.has(`${name}|${r.season}`)) name = `${base} ${m}/${d}`;
        if (byKey.has(`${name}|${r.season}`)) name = `${base} ${y}-${m}-${d}`;
      }
      byKey.set(`${name}|${r.season}`, { ...r, name });
    }
    const rows = [...byKey.values()];
    if (DRY_RUN) {
      console.log("── DRY RUN — API 회차 전체 (도시 | 시즌 | 날짜 | 짝) ──");
      for (const r of [...apiRows].sort((a, b) => a.start_date.localeCompare(b.start_date))) {
        const pair = used.has(r) ? "큐레이션과 병합" : "단독";
        console.log(`  ${r.season} | ${r.start_date}~${r.end_date} | ${r.api_city} | ${pair}`);
      }
      console.log("── DRY RUN — 큐레이션 짝짓기 결과 ──");
      for (const c of curated) {
        const cands = apiByCS.get(`${cityKey(c)}|${c.season}`) ?? [];
        console.log(`  ${c.season} | ${c.start_date ?? "미정"} | ${c.name} | API 후보 ${cands.length}개: ${cands.map((x) => x.start_date).join(", ") || "-"}`);
      }
    }
    console.log(
      `result api: ${raw.length} division-rows → ${apiRows.length} weekends ` +
        `(${paired} paired with curated, ${collided} key collisions) ` +
        `+ curated ${curated.length} → ${rows.length} · ` +
        `complete seasons: ${[...completeSeasons].join(", ") || "없음"}`,
    );
    // completeSeasons: 페이지 끝까지 받았고 비정상 축소가 없는 시즌만 — orphan 정리는
    // 이 집합 안에서만 한다. 큐레이션이 다른 시즌을 섞어도 그 시즌은 정리 범위가 아니다.
    return { from: `${RESULT_API_BASE}/events + curated json`, rows, completeSeasons };
  }
  if (API_URL) {
    const res = await fetch(API_URL, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`source API ${res.status} ${res.statusText}`);
    const json = await res.json();
    // 배열이거나 {events:[...]}/{data:[...]} 형태를 허용
    const arr = Array.isArray(json) ? json : (json.events ?? json.data ?? []);
    // 제네릭 피드는 시즌 완전성을 말해 주지 않는다 → 정리 범위 없음
    return { from: API_URL, rows: arr.map(normalize).filter(Boolean), completeSeasons: new Set() };
  }
  // 큐레이션은 미래 일정 위주라 API 실측 행을 담보하지 못한다 → 정리 범위 없음
  return { from: "curated json", rows: await loadCurated(), completeSeasons: new Set() };
}

async function main() {
  if (!SERVICE_ROLE && !DRY_RUN) {
    console.error("::error::SUPABASE_SERVICE_ROLE_KEY not set — cannot sync");
    process.exit(1);
  }

  if (DRY_RUN && RESULT_API_TOKEN) await probeResultApi();

  const { from, rows, completeSeasons = new Set() } = await loadSource();
  console.log(`source: ${from}`);
  console.log(`events: ${rows.length} valid`);
  console.log(`prune scope (완전성 입증 시즌): ${[...completeSeasons].join(", ") || "없음"}`);
  if (!rows.length) {
    console.log("nothing to sync");
    return;
  }

  // PostgREST 벌크 upsert 는 배열의 모든 객체가 같은 키 집합이어야 한다
  // (아니면 400 PGRST102 "All object keys must match"). 큐레이션 경로와 API
  // 경로가 각자 행을 만들기 때문에 한쪽에만 컬럼을 추가하면 조용히 어긋난다 —
  // 실제로 city_en·country_code 를 API 쪽에만 넣었다가 주간 동기화가 죽었다.
  // 드라이런에서도 걸리도록 upsert 앞이 아니라 여기서 검사한다.
  if (rows.length > 1) {
    const sig = (r) => Object.keys(r).sort().join(",");
    const base = sig(rows[0]);
    const bad = rows.find((r) => sig(r) !== base);
    if (bad) {
      const a = new Set(Object.keys(rows[0]));
      const b = new Set(Object.keys(bad));
      const only = (x, y) => [...x].filter((k) => !y.has(k)).join(", ") || "(없음)";
      throw new Error(
        `행마다 키 집합이 다르다 (PostgREST 벌크 upsert 불가). ` +
          `첫 행에만: ${only(a, b)} / '${bad.name}' 에만: ${only(b, a)}`,
      );
    }
  }

  if (DRY_RUN) {
    console.log("── DRY RUN — 매핑 결과 (DB 미반영) ──");
    for (const r of rows.slice(0, 40)) {
      console.log(
        `${r.season ?? "?"} | ${r.start_date ?? "미정"}~${r.end_date ?? ""} | ${r.name} | ${r.city}, ${r.country} | ${r.region ?? "?"}`,
      );
    }
    if (rows.length > 40) console.log(`… 외 ${rows.length - 40}건`);
    // 실제 실행과 같은 경로(범위 제한 → 참조 검사 → 10건 상한 → 백업 JSON)를 DELETE 만
    // 빼고 돌린다 — 드라이런 출력이 실제 삭제 결과와 어긋나지 않게.
    if (SERVICE_ROLE) {
      console.log("── DRY RUN — 정리 시뮬레이션 (DELETE 미실행) ──");
      const existing = await fetchExisting([...completeSeasons]);
      const keep = new Set(rows.map((r) => `${r.name}|${r.season}`));
      await pruneOrphans(existing, keep, completeSeasons, { dryRun: true });
    } else {
      console.log("── DRY RUN — SERVICE_ROLE 없음: DB 비교(정리 대상) 생략 ──");
    }
    return;
  }

  // 동기화한 시즌의 기존 행 — 신규/갱신 집계와 사후 정리(orphan)에 쓴다.
  // completeSeasons 도 합친다: API 행이 전부 날짜 폴백으로 다른 라벨을 받는 극단적
  // 경우에도 정리 범위 시즌의 기존 행이 조회에서 빠지지 않게.
  const seasons = [
    ...new Set([...rows.map((r) => r.season).filter(Boolean), ...completeSeasons]),
  ];
  const existing = await fetchExisting(seasons);
  const keyOf = (r) => `${r.name}|${r.season}`;
  const existingKeys = new Set(existing.map(keyOf));
  const inserted = rows.filter((r) => !existingKeys.has(keyOf(r))).length;
  console.log(`seasons: ${seasons.join(", ") || "-"} · existing ${existing.length} · new ${inserted} · update ${rows.length - inserted}`);

  // PostgREST 멱등 upsert (uq_race_events_name_season 유니크 인덱스 사용)
  const res = await fetch(
    `${PROJECT_URL}/rest/v1/race_events?on_conflict=name,season`,
    {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE,
        authorization: `Bearer ${SERVICE_ROLE}`,
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    console.error(`::error::upsert failed ${res.status}: ${body}`);
    process.exit(1);
  }
  console.log(`✓ upserted ${rows.length} events into race_events`);

  // 정리는 완전성이 입증된 시즌 안에서만 — 큐레이션·제네릭 피드 경로는 집합이 비어
  // 자동으로 건너뛴다. API 실측 행을 orphan 으로 오인해 지우지 않기 위해서다.
  await pruneOrphans(existing, new Set(rows.map(keyOf)), completeSeasons);
}

const REST = `${PROJECT_URL}/rest/v1`;
const svcHeaders = () => ({
  apikey: SERVICE_ROLE,
  authorization: `Bearer ${SERVICE_ROLE}`,
  "content-type": "application/json",
});

/** 해당 시즌들의 DB 행 (id·키·도시·날짜만) */
async function fetchExisting(seasons) {
  if (!seasons.length) return [];
  const list = seasons.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(",");
  const url =
    `${REST}/race_events?select=id,name,season,city,start_date,end_date` +
    `&season=in.(${encodeURIComponent(list)})`;
  const res = await fetch(url, { headers: svcHeaders() });
  if (!res.ok) throw new Error(`fetch existing ${res.status}: ${await res.text()}`);
  return res.json();
}

/** 시즌별 API 실측 행 수(api_city 가 채워진 행) — 회차 급감 판정의 기준값.
 *  실패하면 던진다: 기준값 없이 정리를 돌리느니 이번 실행을 시끄럽게 멈추는 편이 낫다. */
async function countApiBackedBySeason(seasons) {
  const counts = new Map();
  if (!seasons.length) return counts;
  const list = seasons.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(",");
  const url =
    `${REST}/race_events?select=season&api_city=not.is.null` +
    `&season=in.(${encodeURIComponent(list)})`;
  const res = await fetch(url, { headers: svcHeaders() });
  if (!res.ok) throw new Error(`count api-backed ${res.status}: ${await res.text()}`);
  for (const r of await res.json()) counts.set(r.season, (counts.get(r.season) ?? 0) + 1);
  return counts;
}

/** 지울 행의 전체 컬럼 — 삭제 전 복구용 백업 로그에 쓴다 */
async function fetchFullRows(ids) {
  if (!ids.length) return [];
  const res = await fetch(
    `${REST}/race_events?select=*&id=in.(${ids.join(",")})`,
    { headers: svcHeaders() },
  );
  if (!res.ok) throw new Error(`prune backup fetch ${res.status}: ${await res.text()}`);
  return res.json();
}

/**
 * 완전성이 입증된 시즌(completeSeasons) 안에서 소스에 더는 없는 행을 지운다.
 *  · 범위 밖 시즌의 행은 orphan 으로 보여도 손대지 않는다 — 큐레이션에 과거 시즌이
 *    섞이거나 페이지가 잘린 시즌의 API 전용 행을 지우는 사고를 막기 위해.
 *  · 크루 일정·내 대회 계획이 참조하는 행은 남긴다(FK 도 막지만 조용히 건너뛰려고).
 *  · 한 번에 10행 넘게 지우게 되면 소스 장애일 가능성이 크므로 중단.
 *  · 지우기 직전에 대상 행 전체(모든 컬럼)를 JSON 한 줄로 로그에 남긴다 — 오삭제 시
 *    그 JSON 을 그대로 upsert 하면 복구된다.
 *  · dryRun 이면 DELETE 만 빼고 같은 경로를 돌려 드라이런 출력이 실제와 같게 한다.
 */
async function pruneOrphans(existing, keepKeys, completeSeasons, { dryRun = false } = {}) {
  const tag = dryRun ? "prune(dry)" : "prune";
  if (!completeSeasons.size) {
    console.log(`${tag}: 완전성이 입증된 시즌이 없어 정리 생략`);
    return;
  }
  const scope = existing.filter((r) => completeSeasons.has(r.season));
  const outside = existing.length - scope.length;
  console.log(
    `${tag}: 범위 = 시즌 ${[...completeSeasons].join(", ")} (${scope.length}행` +
      (outside ? `, 범위 밖 ${outside}행은 손대지 않음)` : ")"),
  );
  const orphans = scope.filter((r) => !keepKeys.has(`${r.name}|${r.season}`));
  if (!orphans.length) {
    console.log(`${tag}: 지울 행 없음`);
    return;
  }
  const ids = orphans.map((r) => r.id);
  const inList = `in.(${ids.join(",")})`;
  // 참조 중인 행은 지우지 않는다. FK 는 on delete set null 이라 DB 가 막지는 않지만,
  // 크루 일정·레이스 계획이 가리키던 대회가 조용히 사라지면 안 된다. 참조 테이블을
  // 새로 추가하면 이 목록에도 올릴 것.
  const referenced = new Set();
  for (const [table, col] of [["crew_events", "race_event_id"], ["race_plans", "race_event_id"]]) {
    const res = await fetch(
      `${REST}/${table}?select=${col}&${col}=${inList}`,
      { headers: svcHeaders() },
    );
    if (!res.ok) throw new Error(`prune refs ${table} ${res.status}: ${await res.text()}`);
    for (const row of await res.json()) referenced.add(row[col]);
  }
  const kept = orphans.filter((r) => referenced.has(r.id));
  const del = orphans.filter((r) => !referenced.has(r.id));
  for (const r of kept) console.log(`${tag}: 참조 중이라 유지 — ${r.season} | ${r.name}`);
  if (!del.length) return;
  if (del.length > 10) {
    console.log(`::warning::${tag}: 지울 행이 ${del.length}개 — 소스 이상으로 보고 정리를 건너뜁니다`);
    for (const r of del) console.log(`  · ${r.season} | ${r.start_date ?? "미정"} | ${r.name}`);
    return;
  }
  // 복구용 백업 — 삭제 대상의 전체 컬럼. 행 수가 안 맞으면(동시 변경) 지우지 않는다.
  const backup = await fetchFullRows(del.map((r) => r.id));
  if (backup.length !== del.length) {
    throw new Error(`${tag}: 백업 행 수 불일치 (${backup.length} ≠ ${del.length}) — 삭제 중단`);
  }
  console.log(`${tag}: 삭제 전 백업 ${backup.length}행 (복구용 JSON — 그대로 upsert 하면 복원)`);
  console.log(JSON.stringify(backup));
  if (dryRun) {
    for (const r of del) console.log(`${tag}: 삭제 예정 — ${r.season} | ${r.start_date ?? "미정"} | ${r.name}`);
    return;
  }
  const res = await fetch(
    `${REST}/race_events?id=in.(${del.map((r) => r.id).join(",")})`,
    { method: "DELETE", headers: { ...svcHeaders(), prefer: "return=minimal" } },
  );
  if (!res.ok) throw new Error(`prune delete ${res.status}: ${await res.text()}`);
  for (const r of del) console.log(`prune: 삭제 — ${r.season} | ${r.start_date ?? "미정"} | ${r.name}`);
}

main().catch((e) => {
  console.error(`::error::${e.message}`);
  process.exit(1);
});
