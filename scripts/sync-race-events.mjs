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
  johannesburg: "요하네스버그", cairo: "카이로",
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

/** Result API 이벤트 → race_events 행 */
function normalizeResultApi(raw) {
  const name0 = String(
    pick(raw, ["name", "title", "event_name", "eventName", "label"]) ?? "",
  ).trim();
  if (!name0) return null;
  const name = /hyrox/i.test(name0) ? name0 : `HYROX ${name0}`;

  const cityRaw = String(
    pick(raw, ["city", "location.city", "venue.city", "location"]) ?? "",
  ).trim();
  const countryRaw = String(
    pick(raw, ["country", "location.country", "venue.country", "country_name"]) ?? "",
  ).trim();
  const city = CITY_KO[cityRaw.toLowerCase()] ?? cityRaw;
  const country = COUNTRY_KO[countryRaw.toLowerCase()] ?? countryRaw;
  if (!city || !country) return null;

  const start = toDate(
    pick(raw, ["start_date", "startDate", "date_from", "starts_at", "start", "date"]),
  );
  const end = toDate(
    pick(raw, ["end_date", "endDate", "date_to", "ends_at", "end"]),
  );
  let region = pick(raw, ["region"]);
  if (typeof region === "string") region = region.toLowerCase().replace(/\s+/g, "_");
  if (!REGIONS.has(region)) region = REGION_BY_COUNTRY_KO[country] ?? null;

  return {
    name,
    city,
    country,
    region,
    venue: pick(raw, ["venue", "venue.name", "venue_name", "location.venue"]),
    start_date: start,
    end_date: end,
    date_note: null,
    season: normalizeSeason(pick(raw, ["season.name", "season_name", "season"]), start),
    official_url:
      pick(raw, ["official_url", "url", "website", "link"]) ??
      "https://hyrox.com/find-my-race/",
  };
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
  for (const path of ["/seasons", "/user"]) {
    try {
      const res = await fetch(`${RESULT_API_BASE}${path}`, { headers });
      const body = await res.text();
      console.log(`── GET ${path} → ${res.status} ──`);
      console.log(body.slice(0, 4000));
    } catch (e) {
      console.log(`GET ${path} 실패: ${e.message}`);
    }
  }
}

/** Result API 전체 페이지 수집 (라라벨식 {data, meta}/{links} 페이지네이션 방어) */
async function fetchResultApiEvents() {
  const headers = {
    authorization: `Bearer ${RESULT_API_TOKEN}`,
    accept: "application/json",
  };
  const all = [];
  for (let page = 1; page <= 30; page++) {
    const res = await fetch(`${RESULT_API_BASE}/events?page=${page}`, { headers });
    if (!res.ok) {
      throw new Error(`result api ${res.status} ${res.statusText} (page ${page})`);
    }
    const json = await res.json();
    const arr = Array.isArray(json) ? json : (json.data ?? json.events ?? []);
    if (page === 1) {
      console.log("── result api raw sample (매핑 검증용) ──");
      console.log(JSON.stringify(arr.slice(0, 2), null, 2));
    }
    if (!arr.length) break;
    all.push(...arr);
    if (Array.isArray(json)) break; // 페이지네이션 정보 없음 = 단일 페이지
    const last = json.meta?.last_page ?? json.last_page ?? null;
    if (last != null && page >= Number(last)) break;
    if (last == null && !(json.links?.next ?? json.next_page_url)) break;
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

async function loadSource() {
  if (RESULT_API_TOKEN) {
    const raw = await fetchResultApiEvents();
    // 과거 대회로 테이블이 넘치지 않게 최근(60일 이내 시작)~미래만 유지.
    // 날짜 미상 행은 보수적으로 유지 (미공표 신규 대회일 수 있음).
    const cutoff = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    const rows = raw
      .map(normalizeResultApi)
      .filter(Boolean)
      .filter((r) => r.start_date == null || r.start_date >= cutoff);
    console.log(`result api: ${raw.length} fetched → ${rows.length} kept (>= ${cutoff})`);
    return { from: `${RESULT_API_BASE}/events`, rows, mapped: true };
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
  const here = dirname(fileURLToPath(import.meta.url));
  const file = join(here, "..", "supabase", "data", "race-events.json");
  const rows = JSON.parse(await readFile(file, "utf8"));
  return { from: file, rows: rows.map(normalize).filter(Boolean) };
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
