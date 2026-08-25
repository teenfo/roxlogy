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

/** 시즌 표기 정규화 → 'S9 2026/27'. 실패 시 시작일로 유추 (시즌 경계 6월 가정). */
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
    const y = Number(startDate.slice(0, 4));
    const m = Number(startDate.slice(5, 7));
    const y1 = m >= 6 ? y : y - 1;
    return `S${num[1]} ${y1}/${String(y1 + 1).slice(-2)}`;
  }
  if (startDate) {
    const y = Number(startDate.slice(0, 4));
    const m = Number(startDate.slice(5, 7));
    const y1 = m >= 6 ? y : y - 1;
    return `S${y1 - 2017} ${y1}/${String(y1 + 1).slice(-2)}`;
  }
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
        country: ISO2_KO[g.countryCode] ?? g.countryCode,
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

/** 시즌 카탈로그 → id → 'S9 2026/27' 표기 맵 */
async function fetchSeasonMap() {
  const json = await apiGet(`${RESULT_API_BASE}/seasons?per_page=50`);
  const map = new Map();
  let currentSlug = null;
  let maxN = -1;
  for (const s of json.data ?? []) {
    const n = Number(String(s.slug ?? "").match(/season-(\d+)/)?.[1] ?? NaN);
    const yy = String(s.label ?? "").match(/(\d{2})\s*\/\s*(\d{2})/);
    if (Number.isFinite(n) && yy) {
      map.set(s.id, `S${n} 20${yy[1]}/${yy[2]}`);
      if (n > maxN) {
        maxN = n;
        currentSlug = s.slug;
      }
    }
  }
  return { map, currentSlug };
}

/** 현재 시즌 이벤트 수집 — 서버 필터(season, from)로 요청 수 최소화 */
async function fetchResultApiEvents(seasonSlug, fromDate) {
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const url =
      `${RESULT_API_BASE}/events?season=${encodeURIComponent(seasonSlug)}` +
      `&from=${fromDate}&per_page=100&page=${page}`;
    const json = await apiGet(url);
    const arr = json.data ?? [];
    if (page === 1) {
      console.log("── result api raw sample (매핑 검증용) ──");
      console.log(JSON.stringify(arr.slice(0, 2), null, 2));
    }
    if (!arr.length) break;
    all.push(...arr);
    const last = json.meta?.last_page ?? null;
    if (last != null && page >= Number(last)) break;
  }
  return all;
}

/** 소스 레코드(제네릭/큐레이션) → race_events 행으로 정규화 + 검증 */
function normalize(raw) {
  const row = {
    name: (raw.name ?? "").toString().trim(),
    city: (raw.city ?? "").toString().trim(),
    country: (raw.country ?? "").toString().trim(),
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
  return row;
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
    const cutoff = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    const { map: seasonMap, currentSlug } = await fetchSeasonMap();
    if (!currentSlug) throw new Error("season catalog empty");
    const raw = await fetchResultApiEvents(currentSlug, cutoff);
    const apiRows = aggregateResultApi(raw, seasonMap);
    const curated = await loadCurated();

    const near = (a, b) =>
      Math.abs(
        (Date.parse(a.start_date ?? 0) - Date.parse(b.start_date ?? 0)) / 86400000,
      ) <= 7;
    const dupOfCurated = (r) =>
      curated.some(
        (c) =>
          c.city === r.city && c.start_date && r.start_date && near(c, r),
      );
    const fresh = apiRows.filter((r) => !dupOfCurated(r));
    // (name, season) 충돌 시 API 실측이 큐레이션(조사 시점 날짜)을 덮어쓴다 —
    // 같은 키가 한 upsert 에 두 번 있으면 Postgres ON CONFLICT 가 거부한다.
    const byKey = new Map(curated.map((r) => [`${r.name}|${r.season}`, r]));
    let replaced = 0;
    for (const r of fresh) {
      const k = `${r.name}|${r.season}`;
      if (byKey.has(k)) replaced++;
      byKey.set(k, r);
    }
    const rows = [...byKey.values()];
    console.log(
      `result api: ${raw.length} division-rows → ${apiRows.length} weekends ` +
        `(${apiRows.length - fresh.length} dup vs curated, ${replaced} replaced) ` +
        `+ curated ${curated.length} → ${rows.length}`,
    );
    return { from: `${RESULT_API_BASE}/events + curated json`, rows };
  }
  if (API_URL) {
    const res = await fetch(API_URL, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`source API ${res.status} ${res.statusText}`);
    const json = await res.json();
    // 배열이거나 {events:[...]}/{data:[...]} 형태를 허용
    const arr = Array.isArray(json) ? json : (json.events ?? json.data ?? []);
    return { from: API_URL, rows: arr.map(normalize).filter(Boolean) };
  }
  return { from: "curated json", rows: await loadCurated() };
}

async function main() {
  if (!SERVICE_ROLE && !DRY_RUN) {
    console.error("::error::SUPABASE_SERVICE_ROLE_KEY not set — cannot sync");
    process.exit(1);
  }

  if (DRY_RUN && RESULT_API_TOKEN) await probeResultApi();

  const { from, rows } = await loadSource();
  console.log(`source: ${from}`);
  console.log(`events: ${rows.length} valid`);
  if (!rows.length) {
    console.log("nothing to sync");
    return;
  }

  if (DRY_RUN) {
    console.log("── DRY RUN — 매핑 결과 (DB 미반영) ──");
    for (const r of rows.slice(0, 40)) {
      console.log(
        `${r.season ?? "?"} | ${r.start_date ?? "미정"}~${r.end_date ?? ""} | ${r.name} | ${r.city}, ${r.country} | ${r.region ?? "?"}`,
      );
    }
    if (rows.length > 40) console.log(`… 외 ${rows.length - 40}건`);
    return;
  }

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
}

main().catch((e) => {
  console.error(`::error::${e.message}`);
  process.exit(1);
});
