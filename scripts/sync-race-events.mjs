// 대회 일정 자동 동기화 — race_events 멱등 upsert (name+season 충돌 키).
//
// 소스 우선순위:
//   1) HYROX_EVENTS_API_URL 이 있으면 그 JSON을 가져와 사용 (라이브 피드 어댑터)
//   2) 없으면 supabase/data/race-events.json (유지되는 큐레이션 목록)
//
// 보안: SUPABASE_SERVICE_ROLE_KEY 는 CI 시크릿(서버 전용). 클라이언트 노출 금지.
// 실행: node scripts/sync-race-events.mjs   (Node 20+ — 내장 fetch 사용)

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PROJECT_URL = "https://vuloxbpfhyqkvgmpmkst.supabase.co";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const API_URL = process.env.HYROX_EVENTS_API_URL || null;

const REGIONS = new Set([
  "asia",
  "europe",
  "north_america",
  "south_america",
  "africa",
  "oceania",
]);

/** 소스 레코드 → race_events 행으로 정규화 + 검증 */
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
  if (API_URL) {
    const res = await fetch(API_URL, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`source API ${res.status} ${res.statusText}`);
    const json = await res.json();
    // 배열이거나 {events:[...]}/{data:[...]} 형태를 허용
    const arr = Array.isArray(json) ? json : (json.events ?? json.data ?? []);
    return { from: API_URL, rows: arr };
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const file = join(here, "..", "supabase", "data", "race-events.json");
  const rows = JSON.parse(await readFile(file, "utf8"));
  return { from: file, rows };
}

async function main() {
  if (!SERVICE_ROLE) {
    console.error("::error::SUPABASE_SERVICE_ROLE_KEY not set — cannot sync");
    process.exit(1);
  }

  const { from, rows: raw } = await loadSource();
  const rows = raw.map(normalize).filter(Boolean);
  console.log(`source: ${from}`);
  console.log(`events: ${rows.length} valid / ${raw.length} total`);
  if (!rows.length) {
    console.log("nothing to sync");
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
