// 공식 레이스 기록 자동 임포트 — 프로필에 person_ref 를 연동한 사용자의
// 새 공식 결과를 감지해 race_results 에 넣고 알림을 남긴다.
//
// 원칙(S12): 본인이 명시적으로 연동한 인물의 기록만 조회한다.
// 중복 판정: 같은 사용자에 같은 총기록(ms)이 이미 있으면 스킵 (보수적).
//
// 보안: 토큰·서비스 키는 CI 시크릿(서버 전용). SYNC_DRY_RUN=1 이면 로그만.

const PROJECT_URL = "https://vuloxbpfhyqkvgmpmkst.supabase.co";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESULT_API_TOKEN = process.env.HYROX_RESULT_API_TOKEN;
const RESULT_API_BASE =
  process.env.HYROX_RESULT_API_BASE || "https://hyroxresultapi.com/api/v1";
const DRY_RUN = process.env.SYNC_DRY_RUN === "1";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      await sleep((Number(res.headers.get("retry-after")) || 30) * 1000);
      continue;
    }
    if (res.status === 404) return null;
    if (res.status === 400) {
      // 잘못된 ID 형태 등 행 단위 문제 — 전체 동기화를 죽이지 않는다
      console.log(`  ! result api 400 (${url}) — skipping`);
      return null;
    }
    if (!res.ok) throw new Error(`result api ${res.status} (${url})`);
    return res.json();
  }
  throw new Error(`rate-limited repeatedly (${url})`);
}

async function db(path, init = {}) {
  const res = await fetch(`${PROJECT_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE,
      authorization: `Bearer ${SERVICE_ROLE}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`db ${res.status} ${path}: ${await res.text()}`);
  // return=minimal 인 POST 는 201 + 빈 본문 — json() 하면 죽는다
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function mapDivision(name) {
  const k = String(name ?? "").toUpperCase();
  if (!k) return null;
  if (/MIXED\s+DOUBLES/.test(k)) return "mixed_doubles";
  if (/PRO\s+DOUBLES/.test(k)) return "pro_doubles";
  if (/DOUBLES/.test(k)) return "doubles";
  if (/RELAY/.test(k)) return "relay";
  if (/PRO/.test(k)) return "pro";
  if (/HYROX/.test(k)) return "open";
  return null;
}

const STATION_BY_KEY = {
  ski_erg: "ski", sled_push: "sledpush", sled_pull: "sledpull",
  burpee_broad_jump: "burpee", burpee_broad_jumps: "burpee",
  row: "row", rowing: "row", farmers_carry: "farmers",
  sandbag_lunges: "lunges", lunges: "lunges", wall_balls: "wallballs",
};

/** canonical_key 가 낯선 형태일 때 원문 라벨로 스테이션을 분류하는 폴백 */
function stationFromLabel(label) {
  const l = String(label ?? "").toLowerCase();
  if (!l) return null;
  if (/ski/.test(l)) return "ski";
  if (/sled\s*push/.test(l)) return "sledpush";
  if (/sled\s*pull/.test(l)) return "sledpull";
  if (/burpee/.test(l)) return "burpee";
  if (/row/.test(l) && !/run/.test(l)) return "row";
  if (/farmer/.test(l)) return "farmers";
  if (/lunge/.test(l)) return "lunges";
  if (/wall/.test(l)) return "wallballs";
  return null;
}

/** 스플릿 행들 → race_results.splits jsonb (웹 상세 페이지 계약)
 *  place(스플릿별 필드 순위)가 있으면 stations_place/runs_place 로 함께 보존. */
function buildSplits(rows, unknownKeys) {
  const stations = {};
  const stationsPlace = {};
  const runs = [];
  const runsPlace = [];
  const roxzones = [];
  for (const s of rows ?? []) {
    // 구형 레이스는 "run1_time"/"ski_erg_time" 형태 — _time 접미 제거
    const key = String(s.canonical_key ?? "")
      .toLowerCase()
      .replace(/_time$/, "");
    const ms = s.time_ms;
    if (ms == null) continue;
    const place = Number(s.place ?? s.rank ?? s.position);
    const hasPlace = Number.isFinite(place) && place > 0;
    const label = String(s.label_original ?? s.label ?? "").toLowerCase();
    const run =
      key.match(/^run[_ ]?(\d)$/) ?? label.match(/^run(?:ning)?\s*(\d)$/);
    const rox =
      key.match(/^rox_?zone[_ ]?(\d)$/) ?? label.match(/^rox\s*zone\s*(\d)$/);
    const stationKey = STATION_BY_KEY[key] ?? stationFromLabel(label);
    if (run) {
      runs[Number(run[1]) - 1] = ms;
      if (hasPlace) runsPlace[Number(run[1]) - 1] = place;
    } else if (rox) {
      roxzones[Number(rox[1]) - 1] = ms;
    } else if (stationKey) {
      if (stations[stationKey] == null) {
        stations[stationKey] = ms;
        if (hasPlace) stationsPlace[stationKey] = place;
      }
    } else if (unknownKeys) {
      unknownKeys.add(`${key}|${label}`);
    }
  }
  const runsClean = runs.filter((v) => v != null);
  const roxClean = roxzones.filter((v) => v != null);
  const out = { stations };
  if (runsClean.length === 8) {
    out.runs = runsClean;
    out.run_total_ms = runsClean.reduce((a, b) => a + b, 0);
    if (runsPlace.some((v) => v != null)) out.runs_place = runsPlace;
  }
  if (Object.keys(stationsPlace).length) out.stations_place = stationsPlace;
  if (roxClean.length) out.roxzones = roxClean;
  return out;
}

/** 이벤트(디비전×요일) 정보 — 완주자 수(field_size 분모)와 도시(대회명) */
const eventInfoCache = new Map();
async function fetchEventInfo(slug) {
  if (!slug) return null;
  if (eventInfoCache.has(slug)) return eventInfoCache.get(slug);
  let info = null;
  try {
    const j = await apiGet(
      `${RESULT_API_BASE}/events/${encodeURIComponent(slug)}`,
    );
    const ev = j?.data ?? j;
    const v = Number(ev?.results_count ?? ev?.resultsCount);
    info = {
      count: Number.isFinite(v) && v > 0 ? v : null,
      city: ev?.city ?? null,
      name: ev?.name ?? null,
      startDate: ev?.start_date ?? null,
      endDate: ev?.end_date ?? null,
    };
  } catch {
    info = null;
  }
  eventInfoCache.set(slug, info);
  return info;
}

/** 이벤트 정보 → 레이스 날짜. results 행에 날짜가 없으므로 이벤트 주말
 *  범위에서 유도한다 — 이벤트명에 요일("- Saturday")이 있으면 그 요일. */
const WEEKDAY_IDX = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};
function eventDayFromInfo(info) {
  if (!info?.startDate) return null;
  const start = new Date(`${info.startDate}T00:00:00Z`);
  const end = new Date(`${info.endDate ?? info.startDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return null;
  const m = String(info.name ?? "")
    .toLowerCase()
    .match(/(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/);
  if (m && !Number.isNaN(end.getTime())) {
    const want = WEEKDAY_IDX[m[1]];
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1))
      if (d.getUTCDay() === want) return d.toISOString().slice(0, 10);
  }
  return String(info.startDate).slice(0, 10);
}

/** "season-9-…" 슬러그 → "2026/27 (S9)" (race_results.season 라벨 규약) */
function seasonLabelFromSlug(slug) {
  const m = String(slug ?? "").match(/^season-(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return `20${17 + n}/${18 + n} (S${n})`;
}

/** "choho kim, juhwan kim" → 첫 인물 {person:"choho kim", first, last} */
function firstPersonName(p) {
  const person = String(p.hyrox_athlete_name ?? "").split(",")[0].trim();
  const parts = person.split(/\s+/);
  if (parts.length < 2) return null;
  return {
    person,
    last: parts[parts.length - 1],
    first: parts.slice(0, -1).join(" "),
  };
}

/** 이름 검색 — 이 인물의 시즌별 athlete row(레이스별) 히트 전부 */
async function searchHitsForProfile(p) {
  const name = firstPersonName(p);
  if (!name) return [];
  const out = [];
  for (const season of SEARCH_SEASONS) {
    const q = new URLSearchParams({
      last: name.last,
      first: name.first,
      season,
    });
    const json = await apiGet(`${RESULT_API_BASE}/athletes/search?${q}`);
    out.push(...(json?.data ?? []));
  }
  return out;
}

const pick = (obj, keys) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
};

async function main() {
  if (!RESULT_API_TOKEN) {
    console.log("HYROX_RESULT_API_TOKEN not set — skipping athlete sync.");
    return;
  }
  if (!SERVICE_ROLE) {
    console.error("::error::SUPABASE_SERVICE_ROLE_KEY not set");
    process.exit(1);
  }

  const linked = await db(
    "profiles?select=id,hyrox_person_ref,hyrox_athlete_name&hyrox_person_ref=not.is.null",
  );
  console.log(`linked athletes: ${linked.length}`);

  for (const p of linked) {
    const existing = await db(
      `race_results?select=id,total_time_ms,event_date,splits&user_id=eq.${p.id}`,
    );
    const known = new Set(existing.map((r) => r.total_time_ms));
    // 연동 전 수동 기록과의 매칭: 대회 날짜 ±3일이면 같은 레이스로 본다
    const dateNear = (a, b) =>
      a && b && Math.abs((Date.parse(a) - Date.parse(b)) / 86400000) <= 3;

    // 연동된 ref 하나로는 레이스별 athlete row 를 다 못 본다(더블/릴레이는
    // 등록명이 달라 ref 가 갈라짐) — 이름 검색으로 이 인물의 다른 ref 도 수집
    const hits = await searchHitsForProfile(p);
    const refs = new Set([p.hyrox_person_ref]);
    for (const h of hits) if (h?.person_ref) refs.add(h.person_ref);
    const personName = firstPersonName(p)?.person?.toLowerCase() ?? null;
    console.log(
      `  ${p.hyrox_athlete_name ?? p.id}: ${refs.size} athlete refs (${hits.length} search hits)`,
    );

    for (const ref of refs) {
    const json = await apiGet(
      `${RESULT_API_BASE}/athletes/${encodeURIComponent(ref)}/results?limit=25`,
    );
    const rows = json?.data ?? [];
    if (!rows.length) continue;
    const isLinkedRef = ref === p.hyrox_person_ref;
    console.log(`  ref ${String(ref).slice(0, 10)}…: ${rows.length} races`);

    for (const r of rows) {
      // 검색으로 발견한 ref 는 동명이인 방지 — 행의 선수명에 본인 이름 필수
      if (!isLinkedRef && personName) {
        const rowName = String(
          pick(r, ["athlete_name", "display_name", "name"]) ?? "",
        ).toLowerCase();
        if (!rowName.includes(personName)) continue;
      }
      const total = pick(r, ["total_time_ms", "totalTimeMs", "total_ms"]);
      if (total == null) continue;
      const raceId = pick(r, ["id", "race_id"]);
      const eventName = pick(r, ["event_name", "race_name", "event"]);
      const eventSlug = pick(r, ["event_slug", "eventSlug"]);
      const rankOverall = pick(r, ["rank_overall", "overall_rank"]);
      const eventDate = String(
        pick(r, ["event_date", "race_date", "date", "started_at"]) ?? "",
      ).slice(0, 10);
      const validDate = /^\d{4}-\d{2}-\d{2}$/.test(eventDate) ? eventDate : null;
      const division = mapDivision(pick(r, ["division_name", "division"]));

      // 같은 레이스로 볼 기존 기록: 대회 날짜 ±3일 우선, 없으면 같은 총기록
      const prior =
        (validDate
          ? existing.find((e) => dateNear(e.event_date, validDate))
          : null) ?? existing.find((e) => e.total_time_ms === total) ?? null;
      const priorHasSplits =
        prior && Object.keys(prior.splits?.stations ?? {}).length > 0;
      const priorHasPlaces =
        prior &&
        (Object.keys(prior.splits?.stations_place ?? {}).length > 0 ||
          (prior.splits?.runs_place?.length ?? 0) > 0);
      // 스플릿·순위까지 다 있으면 완결 — 스킵
      if (prior && priorHasSplits && priorHasPlaces) continue;
      // 날짜 매칭이 안 되는 중복(총기록 동일)도 안전망으로 스킵
      if (!prior && known.has(total)) continue;

      // 스플릿 조회: results 행의 id 는 "stored result id" — 스펙상
      // /athletes/{athlete_id}/splits?result_id={id} 로 조회한다.
      // (race ID 직접 경로는 검색 히트의 id 전용)
      let splits = { stations: {} };
      const unknownKeys = new Set();
      const athleteId = pick(r, ["athlete_id", "athleteId"]) ?? ref;
      if (raceId != null && athleteId) {
        const sp = await apiGet(
          `${RESULT_API_BASE}/athletes/${encodeURIComponent(String(athleteId))}/splits?result_id=${encodeURIComponent(String(raceId))}`,
        );
        splits = buildSplits(sp?.data, unknownKeys);
      }
      if (unknownKeys.size)
        console.log(`  ! unmatched split keys: ${[...unknownKeys].join(", ")}`);
      const eventInfo = await fetchEventInfo(eventSlug);
      const fieldSize = eventInfo?.count ?? null;
      if (fieldSize != null) splits.field_size = fieldSize;
      if (rankOverall != null && Number(rankOverall) > 0)
        splits.rank_overall = Number(rankOverall);

      if (prior && priorHasSplits) {
        // 이미 스플릿이 있는 기록: 순위 정보(place/field_size)만 백필.
        // 새로 추가되는 정보가 없으면 건드리지 않는다 (매주 재패치 방지)
        const gotPlaces =
          Object.keys(splits.stations_place ?? {}).length > 0 ||
          (splits.runs_place?.length ?? 0) > 0;
        const addsField =
          fieldSize != null && prior.splits?.field_size == null;
        if (!gotPlaces && !addsField) continue;
        if (DRY_RUN) {
          console.log(`  DRY: would backfill split places (${prior.id})`);
          continue;
        }
        const merged = { ...(prior.splits ?? {}), ...splits };
        if (!Object.keys(splits.stations ?? {}).length)
          merged.stations = prior.splits?.stations ?? {};
        await db(`race_results?id=eq.${prior.id}`, {
          method: "PATCH",
          headers: { prefer: "return=minimal" },
          body: JSON.stringify({ splits: merged }),
        });
        known.add(total);
        console.log(`  ✓ backfilled split places for ${prior.id}`);
        continue;
      }

      if (prior) {
        if (DRY_RUN) {
          console.log(`  DRY: would enrich existing record (${validDate})`);
          continue;
        }
        await db(`race_results?id=eq.${prior.id}`, {
          method: "PATCH",
          headers: { prefer: "return=minimal" },
          body: JSON.stringify({
            total_time_ms: total,
            division: division ?? undefined,
            splits,
          }),
        });
        known.add(total);
        console.log(`  ✓ enriched existing record ${validDate} → ${total}ms`);
        continue;
      }

      // 대회명: 이벤트의 city("2026 Shenzhen")에서 연도를 떼고 구성.
      // results 행의 event_name 은 "HYROX PRO DOUBLES - Saturday" 같은
      // 디비전×요일 명칭이라 그대로 쓰지 않는다.
      const city = eventInfo?.city
        ? String(eventInfo.city).replace(/^\d{4}\s*/, "").trim()
        : null;
      const finalDate = validDate ?? eventDayFromInfo(eventInfo);
      const record = {
        user_id: p.id,
        event: city ? `HYROX ${city}` : (eventName ?? "HYROX"),
        event_date: finalDate,
        division,
        season: seasonLabelFromSlug(eventSlug),
        total_time_ms: total,
        splits,
      };
      if (DRY_RUN) {
        console.log(`  DRY: would import ${record.event} ${total}ms`);
        continue;
      }
      await db("race_results", {
        method: "POST",
        headers: { prefer: "return=minimal" },
        body: JSON.stringify(record),
      });
      existing.push({
        id: null,
        total_time_ms: total,
        event_date: finalDate,
        splits,
      });
      await db("notifications", {
        method: "POST",
        headers: { prefer: "return=minimal" },
        body: JSON.stringify({
          user_id: p.id,
          type_key: "race_imported",
          title: "공식 레이스 기록이 등록됐어요",
          body: `${record.event} — 새 공식 기록을 자동으로 가져왔습니다.`,
          url: "/races",
        }),
      });
      known.add(total);
      console.log(`  ✓ imported ${record.event} (${total}ms)`);
    }
    }

    await backfillPlacesViaSearch(p, existing, hits);
  }
  console.log("athlete sync done");
}

/**
 * 과거 시즌 백필 — /athletes/{ref}/results 에 안 잡히는 예전 기록은
 * 이름 검색(시즌별)으로 레이스 ID를 찾아 총기록(ms) 정확 일치로 매칭한 뒤
 * 스플릿 place 를 채운다. 이미 place 가 있는 기록은 건드리지 않는다.
 */
const SEARCH_SEASONS = ["season-9", "season-8", "season-7"];
async function backfillPlacesViaSearch(p, existing, hits) {
  const missing = existing.filter(
    (e) =>
      e.id != null &&
      Object.keys(e.splits?.stations ?? {}).length > 0 &&
      !Object.keys(e.splits?.stations_place ?? {}).length,
  );
  if (!missing.length) return;

  const byTotal = new Map();
  for (const h of hits ?? []) {
    if (h?.total_time_ms != null && h?.id != null && !byTotal.has(h.total_time_ms))
      byTotal.set(h.total_time_ms, h.id);
  }
  console.log(
    `  search backfill: ${missing.length} records w/o places, ${byTotal.size} search totals`,
  );
  if (!byTotal.size) return;

  let sampleLogged = false;
  for (const e of missing) {
    const hitId = byTotal.get(e.total_time_ms);
    if (hitId == null) {
      console.log(`  - no search match for ${e.total_time_ms}ms (${e.id})`);
      continue;
    }
    const sp = await apiGet(
      `${RESULT_API_BASE}/athletes/${encodeURIComponent(String(hitId))}/splits`,
    );
    if (!sampleLogged && sp?.data?.length) {
      console.log(`  splits sample: ${JSON.stringify(sp.data[0]).slice(0, 300)}`);
      sampleLogged = true;
    }
    const got = buildSplits(sp?.data);
    const gotPlaces =
      Object.keys(got.stations_place ?? {}).length > 0 ||
      (got.runs_place?.length ?? 0) > 0;
    if (!gotPlaces) continue;
    if (DRY_RUN) {
      console.log(`  DRY: would backfill places via search (${e.id})`);
      continue;
    }
    const merged = { ...(e.splits ?? {}) };
    if (got.stations_place) merged.stations_place = got.stations_place;
    if (got.runs_place) merged.runs_place = got.runs_place;
    await db(`race_results?id=eq.${e.id}`, {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ splits: merged }),
    });
    console.log(`  ✓ backfilled places via search: ${e.id} (${e.total_time_ms}ms)`);
  }
}

main().catch((e) => {
  console.error(`::error::${e.message}`);
  process.exit(1);
});
