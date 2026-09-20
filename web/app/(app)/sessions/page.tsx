import Link from "next/link";
import { ArrowRight, Check, Plus, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { formatDate, formatDateShort, formatMs, todayISOIn } from "@/lib/format";
import { ExportButton } from "@/components/export-button";
import { RowLink } from "@/components/row-link";
import {
  Chip,
  DataTable,
  Empty,
  Go,
  PageHead,
  Panel,
  Stats,
} from "@/components/rox/ui";
import { QueryChoice, QuerySegments } from "@/components/rox/query-filters";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.sessions") };
}

const PAGE_SIZE = 20;
const SOURCES = ["all", "web", "watch", "phone"] as const;
const PERIODS = ["all", "7d", "30d", "90d"] as const;
const TYPES = ["all", "sim", "erg"] as const;
type Source = (typeof SOURCES)[number];
type Period = (typeof PERIODS)[number];
type SessType = (typeof TYPES)[number];

const PERIOD_DAYS: Record<Period, number | null> = {
  all: null,
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/**
 * 세션 기록 — 시안 records.tsx 의 Records 그대로 (PORT_PLAN §3-b):
 * PageHead(CSV·세션 기록) · Stats 4 · Panel "기록 목록"(툴바 · DataTable · Empty).
 * 필터는 시안의 클라이언트 상태 대신 쿼리스트링(서버 WHERE)이다 — QueryChoice/QuerySegments.
 */
export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    source?: string;
    period?: string;
    type?: string;
  }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const source = (SOURCES as readonly string[]).includes(sp.source ?? "")
    ? (sp.source as Source)
    : "all";
  const period = (PERIODS as readonly string[]).includes(sp.period ?? "")
    ? (sp.period as Period)
    : "all";
  const type = (TYPES as readonly string[]).includes(sp.type ?? "")
    ? (sp.type as SessType)
    : "all";
  const from = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();
  const { t, tag, tz } = await getT();
  const user = await getCachedUser();

  // 타입 필터: 해당하는 세션 id를 선별해 일반 id 필터로 적용
  // (count/range와 호환되도록 일반 WHERE 절로 들어감)
  // 시뮬 세션 id — 타입 필터와 요약의 "시뮬 N" 이 같은 판정을 쓰도록 한 번만 뽑는다.
  //  · 삭제된 세션은 제외한다. 소프트 삭제라 세그먼트가 그대로 남아 있어
  //    필터를 안 걸면 지운 세션까지 세어진다(실측 7건이 30건으로 잡혔다).
  //  · 대회 세션도 스테이션 8개를 가지므로 빼야 한다. 안 그러면 대회가
  //    시뮬로 중복 계산돼 "대회 6 · 시뮬 7" 처럼 총합을 넘는다.
  const [{ data: stationRows }, { data: raceIdRows }] = await Promise.all([
    supabase
      .from("session_segments")
      .select("session_id, sessions!inner ( user_id, deleted_at )")
      .eq("kind", "station")
      .eq("sessions.user_id", user!.id)
      .is("sessions.deleted_at", null),
    supabase
      .from("sessions")
      .select("id")
      .eq("user_id", user!.id)
      .is("deleted_at", null)
      .not("race_result_id", "is", null),
  ]);
  const raceIdSet = new Set((raceIdRows ?? []).map((r) => r.id as string));
  const simIds = [
    ...new Set((stationRows ?? []).map((r) => r.session_id as string)),
  ].filter((id) => !raceIdSet.has(id));

  let typeIds: string[] | null = null;
  if (type === "sim") {
    typeIds = simIds;
  } else if (type === "erg") {
    // 에르그 = 세그먼트가 머신(PM5) 하나뿐인 세션 — 배지 판정과 같은 기준
    const { data: segRows } = await supabase
      .from("session_segments")
      .select("session_id, machine_type, sessions!inner ( user_id )")
      .eq("sessions.user_id", user!.id);
    const by = new Map<string, { total: number; machines: number }>();
    for (const r of segRows ?? []) {
      const cur = by.get(r.session_id) ?? { total: 0, machines: 0 };
      cur.total++;
      if (r.machine_type) cur.machines++;
      by.set(r.session_id, cur);
    }
    typeIds = [...by.entries()]
      .filter(([, v]) => v.total === 1 && v.machines === 1)
      .map(([id]) => id);
  }

  let query = supabase
    .from("sessions")
    .select(
      `id, started_at, total_time_ms, source_device, analysis_status, division,
       race_results ( event, event_date, season, division )`,
      { count: "exact" },
    )
    // 관리자는 RLS 로 전체 세션이 보이므로, "내 세션" 화면은 명시적으로 본인 것만
    .eq("user_id", user!.id)
    .is("deleted_at", null);

  if (source !== "all") query = query.eq("source_device", source);
  const days = PERIOD_DAYS[period];
  if (days != null) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    query = query.gte("started_at", cutoff.toISOString());
  }
  if (typeIds != null) query = query.in("id", typeIds.length ? typeIds : [""]);

  const { data: sessions, count } = await query
    .order("started_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  const total = count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ---- 요약 카드용 집계 (필터와 무관한 전체 기준)
  type RaceAgg = {
    id: string;
    total_time_ms: number | null;
    race_results: { event: string | null; season: string | null; division: string | null }[]
      | { event: string | null; season: string | null; division: string | null }
      | null;
  };
  const [{ data: raceAggRows }, { data: latestRows }, { data: nextPlans }] =
    await Promise.all([
      supabase
        .from("sessions")
        .select("id, total_time_ms, race_results!inner ( event, season, division )")
        .eq("user_id", user!.id)
        .is("deleted_at", null)
        .not("total_time_ms", "is", null),
      supabase
        .from("sessions")
        .select("id, total_time_ms, started_at")
        .eq("user_id", user!.id)
        .is("deleted_at", null)
        .not("total_time_ms", "is", null)
        .order("started_at", { ascending: false })
        .limit(1),
      supabase
        .from("race_plans")
        .select("title, race_date")
        .eq("user_id", user!.id)
        .gte("race_date", todayISOIn(tz))
        .order("race_date")
        .limit(1),
    ]);

  const races = ((raceAggRows ?? []) as RaceAgg[]).map((r) => {
    const rr = Array.isArray(r.race_results) ? r.race_results[0] : r.race_results;
    return { id: r.id, ms: r.total_time_ms!, ...rr };
  });
  // 개인 최고 = 대회 기록 중 최소. 대회가 없으면 "—"
  // (시뮬 최소를 PB 라고 부르면 실제 대회 기록과 뒤섞인다)
  const pb = races.reduce<(typeof races)[number] | null>(
    (a, r) => (a == null || r.ms < a.ms ? r : a),
    null,
  );
  const latest = (latestRows ?? [])[0] as
    | { id: string; total_time_ms: number; started_at: string }
    | undefined;
  const nextPlan = (nextPlans ?? [])[0] as
    | { title: string; race_date: string }
    | undefined;
  const dday = nextPlan
    ? Math.round(
        (new Date(`${nextPlan.race_date}T00:00:00`).getTime() -
          new Date(`${todayISOIn(tz)}T00:00:00`).getTime()) /
          86400000,
      )
    : null;

  // 에르그(PM5) 세션 표시 — 이 페이지의 세션만 조회해 머신 종류를 뽑는다.
  const pageIds = (sessions ?? []).map((s) => s.id);
  const ergMachine = new Map<string, string>();
  if (pageIds.length) {
    const { data: segs } = await supabase
      .from("session_segments")
      .select("session_id, machine_type")
      .in("session_id", pageIds);
    const bySession = new Map<string, { total: number; machines: string[] }>();
    for (const seg of segs ?? []) {
      const cur = bySession.get(seg.session_id) ?? { total: 0, machines: [] };
      cur.total++;
      if (seg.machine_type) cur.machines.push(seg.machine_type);
      bySession.set(seg.session_id, cur);
    }
    for (const [id, v] of bySession) {
      if (v.total === 1 && v.machines.length === 1) ergMachine.set(id, v.machines[0]);
    }
  }
  const ergLabel = (m: string) => (m === "ski" ? "SkiErg" : m === "row" ? "RowErg" : "Erg");

  // 페이지 이동 — 필터를 유지한다
  const pageHref = (p: number) => {
    const q = new URLSearchParams();
    if (source !== "all") q.set("source", source);
    if (period !== "all") q.set("period", period);
    if (type !== "all") q.set("type", type);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return s ? `/sessions?${s}` : "/sessions";
  };

  const gapLabel = (ms: number) => {
    const d = Math.round(ms / 1000);
    const sign = d >= 0 ? "+" : "−";
    const a = Math.abs(d);
    return `${sign}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`;
  };
  const divLabel = (d: string | null | undefined) =>
    d ? t(`division.${d}` as Parameters<typeof t>[0]) : "";
  const filtered = source !== "all" || period !== "all" || type !== "all";

  const rows = (sessions ?? []).map((sess) => {
    const raceRaw = (sess as { race_results?: unknown }).race_results;
    const race = (Array.isArray(raceRaw) ? raceRaw[0] : raceRaw) as
      | { event: string | null; event_date: string | null; season: string | null; division: string | null }
      | null
      | undefined;
    const erg = ergMachine.get(sess.id) ?? null;
    const isPb = !!pb && sess.id === pb.id;
    const ms = sess.total_time_ms;
    const gap = pb && ms != null && !isPb ? ms - pb.ms : null;
    const name = race?.event ?? formatDate(sess.started_at, tag, tz);
    const pending = sess.analysis_status !== "done";
    return [
      <RowLink className="rx-table-name" href={`/sessions/${sess.id}`} key="name">
        {name}{" "}
        {race ? (
          <Chip tone="yellow">{t("sessions.race")}</Chip>
        ) : erg ? (
          <Chip tone="blue">{ergLabel(erg)}</Chip>
        ) : (
          <Chip>{t("sessions.typeSim")}</Chip>
        )}
        {isPb && <Chip tone="yellow">PB</Chip>}
        <small>
          {formatDateShort(sess.started_at, tag, tz)}
          {race?.season ? ` · ${race.season}` : ""}
          {gap != null ? ` · PB ${gapLabel(gap)}` : ""}
        </small>
      </RowLink>,
      <Chip key="div">{divLabel(race?.division ?? sess.division) || "—"}</Chip>,
      <span className="rx-source" key="src">
        {pending ? <TriangleAlert size={14} /> : <Check size={14} />}{" "}
        {t(`source.${sess.source_device}` as Parameters<typeof t>[0])}
        {pending ? ` · ${t("common.analysisPending")}` : ""}
      </span>,
      <strong className="rx-number" key="time">
        {formatMs(ms)}
      </strong>,
      <RowLink
        aria-label={t("sessions.detailOf", { name })}
        href={`/sessions/${sess.id}`}
        key="go"
      >
        <ArrowRight size={17} />
      </RowLink>,
    ];
  });

  return (
    <>
      <PageHead
        title={t("sessions.title")}
        description={t("sessions.intro")}
        action={
          <div className="rx-actions">
            {total > 0 && <ExportButton kind="sessions" />}
            <Go href="/sessions/new" primary>
              <Plus size={16} />
              {t("sessions.record")}
            </Go>
          </div>
        }
      />
      <Stats
        items={[
          [
            t("dash.totalSessions"),
            String(total),
            `${t("sessions.race")} ${races.length} · ${t("sessions.typeSim")} ${simIds.length}`,
          ],
          [
            t("sessions.latest"),
            latest ? formatMs(latest.total_time_ms) : "—",
            latest && pb ? `PB ${gapLabel(latest.total_time_ms - pb.ms)}` : "",
          ],
          [
            t("sessions.pb"),
            pb ? formatMs(pb.ms) : "—",
            pb ? [pb.event, divLabel(pb.division)].filter(Boolean).join(" · ") : t("dash.noRace"),
          ],
          [
            t("dash.nextRace"),
            dday != null && dday >= 0 ? `D–${dday}` : "—",
            nextPlan ? nextPlan.title : t("sessions.noUpcoming"),
          ],
        ]}
      />
      <Panel
        title={t("sessions.list")}
        action={
          <Go href="/sessions/compare">
            {t("compare.title")} <ArrowRight size={16} />
          </Go>
        }
      >
        <div className="rx-toolbar">
          <QueryChoice
            param="source"
            value={source}
            label={t("sessions.fltSource")}
            options={SOURCES.map((sc) => [
              sc,
              sc === "all"
                ? `${t("sessions.fltSource")}: ${t("sessions.fltAll")}`
                : t(`source.${sc}` as Parameters<typeof t>[0]),
            ])}
          />
          <QueryChoice
            param="period"
            value={period}
            label={t("sessions.fltPeriod")}
            options={PERIODS.map((pr) => [
              pr,
              pr === "all"
                ? `${t("sessions.fltPeriod")}: ${t("sessions.fltAll")}`
                : t(`sessions.period.${pr}` as Parameters<typeof t>[0]),
            ])}
          />
          <QuerySegments
            param="type"
            value={type}
            label={t("sessions.fltType")}
            options={[
              ["all", t("sessions.fltAll")],
              ["sim", t("sessions.typeSim")],
              ["erg", t("sessions.typeErg")],
            ]}
          />
        </div>
        {rows.length > 0 && (
          <DataTable
            headers={[
              t("sessions.colDate"),
              t("sessions.colDivision"),
              t("sessions.colSource"),
              t("sessions.colTime"),
              "",
            ]}
            rows={rows}
          />
        )}
        {!rows.length && (
          <Empty
            title={filtered ? t("sessions.emptyFiltered") : t("sessions.empty")}
            description={filtered ? "" : t("dash.recordFirst")}
            action={
              filtered ? (
                <Go href="/sessions">{t("sessions.resetFilters")}</Go>
              ) : (
                <Go href="/sessions/new" primary>
                  {t("sessions.record")}
                </Go>
              )
            }
          />
        )}
        {lastPage > 1 && (
          <div className="rx-actions" style={{ padding: "16px 24px 24px" }}>
            {page > 1 && <Go href={pageHref(page - 1)}>{t("sessions.pagePrev")}</Go>}
            <span className="rx-list-count" style={{ margin: 0 }}>
              {page} / {lastPage}
            </span>
            {page < lastPage && (
              <Go href={pageHref(page + 1)}>{t("sessions.pageNext")}</Go>
            )}
          </div>
        )}
      </Panel>
      {/* 시안에 없는 링크 — 접근성용 목록 첫 페이지 복귀 */}
      {page > 1 && (
        <Link href="/sessions" className="rx-back">
          {t("sessions.back")}
        </Link>
      )}
    </>
  );
}
