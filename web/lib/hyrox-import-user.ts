import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 본인 공식 기록 즉시 임포트 — CI 주간 동기화(scripts/sync-athlete-results.mjs)의
 * 사용자 스코프 축약판. 설정의 "지금 가져오기" 버튼과 연동 직후 자동 실행이 쓴다.
 *
 * CI 와의 차이: 알림을 만들지 않고(본인이 직접 실행), 호출 상한을 둔다
 * (Vercel 함수 시간 제한). 남는 작업은 주간 동기화가 마저 처리한다.
 * 쓰기는 전부 사용자 세션 클라이언트(RLS own-row)로 수행 — 특권 없음.
 */

const BASE =
  process.env.HYROX_RESULT_API_BASE ?? "https://hyroxresultapi.com/api/v1";
const SEASONS = ["season-9", "season-8", "season-7"];
const MAX_WRITES = 8; // 함수 시간 제한 내 안전 상한

let lastCallAt = 0;
async function apiGet(path: string): Promise<unknown | null> {
  const wait = lastCallAt + 2200 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      authorization: `Bearer ${process.env.HYROX_RESULT_API_TOKEN}`,
      accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404 || res.status === 400) return null;
  if (res.status === 429) return null; // 레이트리밋 — 이번엔 건너뛰고 주간 sync 에 맡김
  if (!res.ok) throw new Error(`result api ${res.status}`);
  return res.json();
}

function mapDivision(name: unknown, sex: string): string | null {
  const k = String(name ?? "").toUpperCase();
  if (!k) return null;
  let div: string | null = null;
  if (/MIXED\s+DOUBLES/.test(k)) div = "mixed_doubles";
  else if (/PRO\s+DOUBLES/.test(k)) div = "pro_doubles";
  else if (/DOUBLES/.test(k)) div = "doubles";
  else if (/RELAY/.test(k)) div = "relay";
  else if (/PRO/.test(k)) div = "pro";
  else if (/HYROX/.test(k)) div = "open";
  if (div === "doubles" && (/^(X|MX)$/.test(sex) || sex.includes("MIX")))
    div = "mixed_doubles";
  return div;
}

const STATION_BY_KEY: Record<string, string> = {
  ski_erg: "ski", sled_push: "sledpush", sled_pull: "sledpull",
  burpee_broad_jump: "burpee", burpee_broad_jumps: "burpee",
  row: "row", rowing: "row", farmers_carry: "farmers",
  sandbag_lunges: "lunges", lunges: "lunges", wall_balls: "wallballs",
};

function stationFromLabel(label: string): string | null {
  const l = label.toLowerCase();
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

type SplitRow = {
  canonical_key?: string | null;
  label_original?: string | null;
  time_ms?: number | null;
  place?: number | null;
};

type Splits = {
  stations: Record<string, number>;
  stations_place?: Record<string, number>;
  runs?: number[];
  runs_place?: (number | null)[];
  run_total_ms?: number;
  roxzones?: number[];
  field_size?: number;
  rank_overall?: number;
  bib?: string;
};

function buildSplits(rows: SplitRow[] | null | undefined): Splits {
  const stations: Record<string, number> = {};
  const stationsPlace: Record<string, number> = {};
  const runs: number[] = [];
  const runsPlace: (number | null)[] = [];
  const roxzones: number[] = [];
  for (const s of rows ?? []) {
    const key = String(s.canonical_key ?? "")
      .toLowerCase()
      .replace(/_time$/, "");
    const label = String(s.label_original ?? "").toLowerCase();
    const ms = s.time_ms;
    if (ms == null) continue;
    const place = Number(s.place);
    const hasPlace = Number.isFinite(place) && place > 0;
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
    } else if (stationKey && stations[stationKey] == null) {
      stations[stationKey] = ms;
      if (hasPlace) stationsPlace[stationKey] = place;
    }
  }
  const runsClean = runs.filter((v) => v != null);
  const roxClean = roxzones.filter((v) => v != null);
  const out: Splits = { stations };
  if (runsClean.length === 8) {
    out.runs = runsClean;
    out.run_total_ms = runsClean.reduce((a, b) => a + b, 0);
    if (runsPlace.some((v) => v != null)) out.runs_place = runsPlace;
  }
  if (Object.keys(stationsPlace).length) out.stations_place = stationsPlace;
  if (roxClean.length) out.roxzones = roxClean;
  return out;
}

const WEEKDAY: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

type EventInfo = {
  count: number | null;
  city: string | null;
  name: string | null;
  startDate: string | null;
  endDate: string | null;
};

function eventDay(info: EventInfo | null): string | null {
  if (!info?.startDate) return null;
  const start = new Date(`${info.startDate}T00:00:00Z`);
  const end = new Date(`${info.endDate ?? info.startDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return null;
  const m = String(info.name ?? "")
    .toLowerCase()
    .match(/(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/);
  if (m && !Number.isNaN(end.getTime())) {
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1))
      if (d.getUTCDay() === WEEKDAY[m[1]]) return d.toISOString().slice(0, 10);
  }
  return String(info.startDate).slice(0, 10);
}

function seasonLabel(slug: unknown): string | null {
  const m = String(slug ?? "").match(/^season-(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return `20${17 + n}/${18 + n} (S${n})`;
}

const pick = (obj: Record<string, unknown>, keys: string[]): unknown => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
};

export type ImportResult = {
  imported: number;
  enriched: number;
  skipped: number;
};

export async function importMyRaces(
  db: SupabaseClient,
  userId: string,
  personRef: string,
  athleteName: string | null,
): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, enriched: 0, skipped: 0 };

  // 이름 검색으로 이 인물의 다른 athlete ref 수집 (더블·릴레이는 ref 가 갈라짐)
  const person = String(athleteName ?? "").split(",")[0].trim();
  const parts = person.split(/\s+/);
  const hits: { id?: unknown; person_ref?: string; total_time_ms?: number; sex?: string; athlete_name?: string }[] = [];
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const first = parts.slice(0, -1).join(" ");
    for (const season of SEASONS) {
      const q = new URLSearchParams({ last, first, season });
      const json = (await apiGet(`/athletes/search?${q}`)) as {
        data?: typeof hits;
      } | null;
      hits.push(...(json?.data ?? []));
    }
  }
  const refs = new Set<string>([personRef]);
  for (const h of hits) if (h?.person_ref) refs.add(h.person_ref);
  const sexByTotal = new Map<number, string>();
  for (const h of hits) {
    const sx = String(h?.sex ?? "").trim().toUpperCase();
    if (h?.total_time_ms != null && sx && !sexByTotal.has(h.total_time_ms))
      sexByTotal.set(h.total_time_ms, sx);
  }

  const { data: existingRows } = await db
    .from("race_results")
    .select("id, total_time_ms, event_date, splits")
    .eq("user_id", userId);
  const existing = (existingRows ?? []) as {
    id: string | null;
    total_time_ms: number | null;
    event_date: string | null;
    splits: Splits | null;
  }[];
  const known = new Set(existing.map((r) => r.total_time_ms));
  const dateNear = (a: string | null, b: string | null) =>
    !!a && !!b && Math.abs((Date.parse(a) - Date.parse(b)) / 86400000) <= 3;

  const eventCache = new Map<string, EventInfo | null>();
  async function eventInfo(slug: string | null): Promise<EventInfo | null> {
    if (!slug) return null;
    if (eventCache.has(slug)) return eventCache.get(slug)!;
    const j = (await apiGet(`/events/${encodeURIComponent(slug)}`)) as {
      data?: Record<string, unknown>;
    } | null;
    const ev = j?.data;
    const v = Number(ev?.results_count);
    const info: EventInfo | null = ev
      ? {
          count: Number.isFinite(v) && v > 0 ? v : null,
          city: (ev.city as string) ?? null,
          name: (ev.name as string) ?? null,
          startDate: (ev.start_date as string) ?? null,
          endDate: (ev.end_date as string) ?? null,
        }
      : null;
    eventCache.set(slug, info);
    return info;
  }

  let writes = 0;
  for (const ref of [...refs].slice(0, 4)) {
    if (writes >= MAX_WRITES) break;
    const json = (await apiGet(
      `/athletes/${encodeURIComponent(ref)}/results?limit=25`,
    )) as { data?: Record<string, unknown>[] } | null;
    for (const r of json?.data ?? []) {
      if (writes >= MAX_WRITES) break;
      // 검색으로 발견한 ref 는 동명이인 방지 — 행의 선수명에 본인 이름 필수
      if (ref !== personRef && person) {
        const rowName = String(
          pick(r, ["athlete_name", "display_name", "name"]) ?? "",
        ).toLowerCase();
        if (!rowName.includes(person.toLowerCase())) continue;
      }
      const total = pick(r, ["total_time_ms", "totalTimeMs", "total_ms"]) as
        | number
        | null;
      if (total == null) continue;
      const raceId = pick(r, ["id", "race_id"]);
      const athleteId = (pick(r, ["athlete_id", "athleteId"]) as string) ?? ref;
      const eventSlug = pick(r, ["event_slug", "eventSlug"]) as string | null;
      const rankOverall = pick(r, ["rank_overall", "overall_rank"]);
      const bib = String(pick(r, ["bib", "bib_number"]) ?? "").trim();
      const sexRaw =
        String(pick(r, ["sex", "gender"]) ?? "").trim().toUpperCase() ||
        sexByTotal.get(total) ||
        "";
      const division = mapDivision(pick(r, ["division_name", "division"]), sexRaw);
      const rowDate = String(
        pick(r, ["event_date", "race_date", "date", "started_at"]) ?? "",
      ).slice(0, 10);
      const validDate = /^\d{4}-\d{2}-\d{2}$/.test(rowDate) ? rowDate : null;

      const prior =
        (validDate
          ? existing.find((e) => dateNear(e.event_date, validDate))
          : null) ?? existing.find((e) => e.total_time_ms === total) ?? null;
      const priorHasSplits =
        !!prior && Object.keys(prior.splits?.stations ?? {}).length > 0;
      const priorHasPlaces =
        !!prior &&
        Object.keys(prior.splits?.stations_place ?? {}).length > 0;
      if (prior && priorHasSplits && priorHasPlaces && prior.splits?.bib) {
        result.skipped++;
        continue;
      }
      if (!prior && known.has(total)) {
        result.skipped++;
        continue;
      }

      let splits: Splits = { stations: {} };
      if (raceId != null && athleteId) {
        const sp = (await apiGet(
          `/athletes/${encodeURIComponent(String(athleteId))}/splits?result_id=${encodeURIComponent(String(raceId))}`,
        )) as { data?: SplitRow[] } | null;
        splits = buildSplits(sp?.data);
      }
      const info = await eventInfo(eventSlug);
      if (info?.count != null) splits.field_size = info.count;
      if (rankOverall != null && Number(rankOverall) > 0)
        splits.rank_overall = Number(rankOverall);
      if (bib) splits.bib = bib;

      if (prior && prior.id) {
        // 기존 기록 보강 (스플릿 없으면 전체, 있으면 place/bib 등만)
        const merged: Splits = { ...(prior.splits ?? { stations: {} }), ...splits };
        if (!Object.keys(splits.stations ?? {}).length)
          merged.stations = prior.splits?.stations ?? {};
        const { error } = await db
          .from("race_results")
          .update({
            splits: merged,
            ...(priorHasSplits ? {} : { total_time_ms: total, division }),
          })
          .eq("id", prior.id);
        if (!error) {
          result.enriched++;
          writes++;
          prior.splits = merged;
          known.add(total);
        }
        continue;
      }

      const city = info?.city
        ? String(info.city).replace(/^\d{4}\s*/, "").trim()
        : null;
      const { error } = await db.from("race_results").insert({
        user_id: userId,
        event: city
          ? `HYROX ${city}`
          : ((pick(r, ["event_name", "race_name", "event"]) as string) ??
            "HYROX"),
        event_date: validDate ?? eventDay(info),
        division,
        season: seasonLabel(eventSlug),
        total_time_ms: total,
        splits,
      });
      if (!error) {
        result.imported++;
        writes++;
        known.add(total);
        existing.push({
          id: null,
          total_time_ms: total,
          event_date: validDate ?? eventDay(info),
          splits,
        });
      }
    }
  }
  return result;
}
