// 백분위 벤치마크 동기화 — Result API 의 대회별 디비전 통계를 집계해
// race_benchmarks(근사 시드)를 실측 분포로 교체한다.
//
// 방법: 최근 대회들의 /stats/divisions/{id} 버킷(디비전×성별×연령)을
// (디비전, 성별) 로 모아 표본수 가중 평균으로 백분위 브레이크포인트를
// 합성한다. p99 는 API 미제공 — 정규 근사(median + 2.326σ, max 클램프).
// 표본이 적은 조합(<30)은 시드를 유지한다.
//
// 보안: 토큰·서비스 키는 CI 시크릿(서버 전용). SYNC_DRY_RUN=1 이면 로그만.
// 실행: node scripts/sync-race-benchmarks.mjs   (Node 20+)

const PROJECT_URL = "https://vuloxbpfhyqkvgmpmkst.supabase.co";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESULT_API_TOKEN = process.env.HYROX_RESULT_API_TOKEN;
const RESULT_API_BASE =
  process.env.HYROX_RESULT_API_BASE || "https://hyroxresultapi.com/api/v1";
const DRY_RUN = process.env.SYNC_DRY_RUN === "1";

const MIN_SAMPLE = 30; // 이보다 작은 (디비전,성별) 조합은 갱신하지 않음
const MAX_EVENTS = 12; // 최근 대회 수집 상한 (레이트리밋 예산)
const LOOKBACK_DAYS = 150;

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
      const retryAfter = Number(res.headers.get("retry-after")) || 30;
      await sleep(retryAfter * 1000);
      continue;
    }
    if (res.status === 404) return null; // 통계 미계산 이벤트
    if (!res.ok) throw new Error(`result api ${res.status} (${url})`);
    return res.json();
  }
  throw new Error(`rate-limited repeatedly (${url})`);
}

/** division_key("HYROX PRO DOUBLES - Saturday" 등) → 우리 디비전 코드 */
function mapDivision(key) {
  const k = String(key ?? "").toUpperCase();
  if (/MIXED\s+DOUBLES/.test(k)) return "mixed_doubles";
  if (/PRO\s+DOUBLES/.test(k)) return "pro_doubles";
  if (/DOUBLES/.test(k)) return "doubles";
  if (/RELAY/.test(k)) return "relay";
  if (/PRO/.test(k)) return "pro";
  if (/HYROX/.test(k)) return "open";
  return null;
}

/** (디비전,성별)별 백분위 누적기 — 표본수 가중 평균 */
function makeAcc() {
  return { n: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0, p99: 0 };
}
function accumulate(acc, stats, count) {
  const p99 = Math.min(
    stats.max_ms ?? Infinity,
    (stats.median_ms ?? stats.p50_ms) + 2.326 * (stats.stddev_ms ?? 0),
  );
  const add = (k, v) => {
    if (v == null) return false;
    acc[k] = (acc[k] * acc.n + v * count) / (acc.n + count);
    return true;
  };
  const ok =
    add("p10", stats.p10_ms) &&
    add("p25", stats.p25_ms) &&
    add("p50", stats.p50_ms ?? stats.median_ms) &&
    add("p75", stats.p75_ms) &&
    add("p90", stats.p90_ms) &&
    add("p99", Number.isFinite(p99) ? p99 : null);
  if (ok) acc.n += count;
}

async function main() {
  if (!RESULT_API_TOKEN) {
    console.log("HYROX_RESULT_API_TOKEN not set — skipping benchmark sync.");
    return;
  }
  if (!SERVICE_ROLE && !DRY_RUN) {
    console.error("::error::SUPABASE_SERVICE_ROLE_KEY not set");
    process.exit(1);
  }

  // 시즌 카탈로그 → 현재 시즌
  const seasons = await apiGet(`${RESULT_API_BASE}/seasons?per_page=50`);
  const latest = (seasons.data ?? []).reduce((best, s) => {
    const n = Number(String(s.slug ?? "").match(/season-(\d+)/)?.[1] ?? -1);
    return !best || n > best.n ? { n, slug: s.slug } : best;
  }, null);
  if (!latest) throw new Error("season catalog empty");

  // 최근 대회(결과 보유) 수집 — 디비전×요일 행이므로 results_count 큰 순으로 상한
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400000)
    .toISOString()
    .slice(0, 10);
  const evs = [];
  for (let page = 1; page <= 5; page++) {
    const json = await apiGet(
      `${RESULT_API_BASE}/events?season=${latest.slug}&from=${cutoff}&per_page=100&page=${page}`,
    );
    const arr = json.data ?? [];
    if (!arr.length) break;
    evs.push(...arr);
    const last = json.meta?.last_page ?? null;
    if (last != null && page >= Number(last)) break;
  }
  const withResults = evs
    .filter((e) => (e.results_count ?? 0) >= MIN_SAMPLE)
    .sort((a, b) => (b.results_count ?? 0) - (a.results_count ?? 0))
    .slice(0, MAX_EVENTS);
  console.log(
    `events: ${evs.length} rows → ${withResults.length} with results (top by field size)`,
  );

  // 대회별 통계 수집 → (디비전, 성별) 누적
  const accs = new Map(); // `${division}|${gender}|${scope}` → acc
  const acc = (d, g, scope = "overall") => {
    const k = `${d}|${g}|${scope}`;
    if (!accs.has(k)) accs.set(k, makeAcc());
    return accs.get(k);
  };
  for (const ev of withResults) {
    const json = await apiGet(`${RESULT_API_BASE}/stats/divisions/${ev.id}`);
    if (!json?.data) continue;
    const division = mapDivision(ev.name);
    if (!division) continue;
    for (const b of json.data.buckets ?? []) {
      const t = b.total_time;
      if (!t || !b.count) continue;
      const gender = b.sex === "M" ? "male" : b.sex === "W" ? "female" : null;
      if (!gender) continue;
      accumulate(acc(division, gender), t, b.count);
      accumulate(acc(division, "all"), t, b.count);
      // 연령그룹 버킷 — scope='age:<그룹>' 인코딩으로 별도 행 (예: age:30-34)
      if (b.age_group) {
        accumulate(acc(division, gender, `age:${b.age_group}`), t, b.count);
      }
    }
    console.log(`  ✓ ${ev.name} @ ${ev.city} (${ev.results_count})`);
  }

  const rows = [];
  for (const [k, a] of accs) {
    if (a.n < MIN_SAMPLE) continue;
    const [division, gender, scope] = k.split("|");
    rows.push({
      division,
      gender,
      scope: scope || "overall",
      percentiles: {
        p10: Math.round(a.p10),
        p25: Math.round(a.p25),
        p50: Math.round(a.p50),
        p75: Math.round(a.p75),
        p90: Math.round(a.p90),
        p99: Math.round(a.p99),
      },
      sample_size: a.n,
      source: `hyroxresultapi ${latest.slug} aggregate`,
    });
  }
  console.log(`benchmarks: ${rows.length} (division×gender) combos ready`);
  for (const r of rows) {
    console.log(
      `${r.division}/${r.gender} n=${r.sample_size} ` +
        `p10=${r.percentiles.p10} p50=${r.percentiles.p50} p90=${r.percentiles.p90} p99=${r.percentiles.p99}`,
    );
  }
  if (DRY_RUN || !rows.length) {
    if (DRY_RUN) console.log("── DRY RUN — DB 미반영 ──");
    return;
  }

  // 기존 캐노니컬 행(클라이언트는 season 무시 조회)을 제자리 갱신 — 없으면 삽입
  const headers = {
    apikey: SERVICE_ROLE,
    authorization: `Bearer ${SERVICE_ROLE}`,
    "content-type": "application/json",
  };
  for (const r of rows) {
    const q =
      `${PROJECT_URL}/rest/v1/race_benchmarks` +
      `?division=eq.${r.division}&gender=eq.${r.gender}&scope=eq.${r.scope}`;
    const patch = await fetch(q, {
      method: "PATCH",
      headers: { ...headers, prefer: "return=representation" },
      body: JSON.stringify({
        percentiles: r.percentiles,
        sample_size: r.sample_size,
        source: r.source,
        updated_at: new Date().toISOString(),
      }),
    });
    const updated = patch.ok ? (await patch.json()).length : 0;
    if (!patch.ok) {
      console.error(`::error::patch failed ${patch.status} (${r.division}/${r.gender})`);
      process.exit(1);
    }
    if (updated === 0) {
      const ins = await fetch(`${PROJECT_URL}/rest/v1/race_benchmarks`, {
        method: "POST",
        headers: { ...headers, prefer: "return=minimal" },
        body: JSON.stringify(r),
      });
      if (!ins.ok) {
        console.error(`::error::insert failed ${ins.status} (${r.division}/${r.gender})`);
        process.exit(1);
      }
    }
  }
  console.log(`✓ race_benchmarks updated (${rows.length} combos)`);
}

main().catch((e) => {
  console.error(`::error::${e.message}`);
  process.exit(1);
});
