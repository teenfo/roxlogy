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
  return res.status === 204 ? null : res.json();
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

/** 스플릿 행들 → race_results.splits jsonb (웹 상세 페이지 계약)
 *  place(스플릿별 필드 순위)가 있으면 stations_place/runs_place 로 함께 보존. */
function buildSplits(rows) {
  const stations = {};
  const stationsPlace = {};
  const runs = [];
  const runsPlace = [];
  const roxzones = [];
  for (const s of rows ?? []) {
    const key = String(s.canonical_key ?? "").toLowerCase();
    const ms = s.time_ms;
    if (ms == null) continue;
    const place = Number(s.place ?? s.rank ?? s.position);
    const hasPlace = Number.isFinite(place) && place > 0;
    const run = key.match(/^run[_ ]?(\d)$/);
    const rox = key.match(/^rox_?zone[_ ]?(\d)$/);
    if (run) {
      runs[Number(run[1]) - 1] = ms;
      if (hasPlace) runsPlace[Number(run[1]) - 1] = place;
    } else if (rox) {
      roxzones[Number(rox[1]) - 1] = ms;
    } else if (STATION_BY_KEY[key] && stations[STATION_BY_KEY[key]] == null) {
      stations[STATION_BY_KEY[key]] = ms;
      if (hasPlace) stationsPlace[STATION_BY_KEY[key]] = place;
    }
  }
  const runsClean = runs.filter((v) => v != null);
  const roxClean = roxzones.filter((v) => v != null);
  const out = { stations };
  if (runsClean.length === 8) {
    out.runs = runsClean;
    out.run_total_ms = runsClean.reduce((a, b) => a + b, 0);
    if (runsPlace.filter((v) => v != null).length === 8)
      out.runs_place = runsPlace;
  }
  if (Object.keys(stationsPlace).length) out.stations_place = stationsPlace;
  if (roxClean.length) out.roxzones = roxClean;
  return out;
}

/** 이벤트(디비전×요일) 완주자 수 — 스플릿 place 를 백분위로 환산할 분모 */
const fieldSizeCache = new Map();
async function fetchFieldSize(slug) {
  if (!slug) return null;
  if (fieldSizeCache.has(slug)) return fieldSizeCache.get(slug);
  let n = null;
  try {
    const j = await apiGet(
      `${RESULT_API_BASE}/events/${encodeURIComponent(slug)}`,
    );
    const ev = j?.data ?? j;
    const v = Number(ev?.results_count ?? ev?.resultsCount);
    if (Number.isFinite(v) && v > 0) n = v;
    if (n == null) {
      const st = await apiGet(
        `${RESULT_API_BASE}/events/${encodeURIComponent(slug)}/ingest-status`,
      );
      const w = Number(
        st?.data?.race?.results_count ?? st?.data?.results_count,
      );
      if (Number.isFinite(w) && w > 0) n = w;
    }
  } catch {
    n = null;
  }
  fieldSizeCache.set(slug, n);
  return n;
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
    const json = await apiGet(
      `${RESULT_API_BASE}/athletes/${encodeURIComponent(p.hyrox_person_ref)}/results?limit=25`,
    );
    const rows = json?.data ?? [];
    if (!rows.length) continue;
    console.log(`  ${p.hyrox_athlete_name ?? p.id}: ${rows.length} official races`);
    console.log(`  sample: ${JSON.stringify(rows[0]).slice(0, 400)}`);

    const existing = await db(
      `race_results?select=id,total_time_ms,event_date,splits&user_id=eq.${p.id}`,
    );
    const known = new Set(existing.map((r) => r.total_time_ms));
    // 연동 전 수동 기록과의 매칭: 대회 날짜 ±3일이면 같은 레이스로 본다
    const dateNear = (a, b) =>
      a && b && Math.abs((Date.parse(a) - Date.parse(b)) / 86400000) <= 3;

    for (const r of rows) {
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

      let splits = { stations: {} };
      if (raceId != null) {
        const sp = await apiGet(
          `${RESULT_API_BASE}/athletes/${encodeURIComponent(String(raceId))}/splits`,
        );
        splits = buildSplits(sp?.data);
      }
      const fieldSize = await fetchFieldSize(eventSlug);
      if (fieldSize != null) splits.field_size = fieldSize;
      if (rankOverall != null && Number(rankOverall) > 0)
        splits.rank_overall = Number(rankOverall);

      if (prior && priorHasSplits) {
        // 이미 스플릿이 있는 기록: 순위 정보(place/field_size)만 백필
        const gotPlaces =
          Object.keys(splits.stations_place ?? {}).length > 0 ||
          (splits.runs_place?.length ?? 0) > 0 ||
          fieldSize != null;
        if (!gotPlaces) continue;
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

      const record = {
        user_id: p.id,
        event: eventName ?? "HYROX",
        event_date: validDate,
        division,
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
  console.log("athlete sync done");
}

main().catch((e) => {
  console.error(`::error::${e.message}`);
  process.exit(1);
});
