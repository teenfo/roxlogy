import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { formatDate, formatMs } from "@/lib/format";
import { ExportButton } from "@/components/export-button";

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
  let typeIds: string[] | null = null;
  if (type === "sim") {
    const { data: segRows } = await supabase
      .from("session_segments")
      .select("session_id, sessions!inner ( user_id )")
      .eq("kind", "station")
      .eq("sessions.user_id", user!.id);
    typeIds = [...new Set((segRows ?? []).map((r) => r.session_id))];
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

  // 에르그(PM5) 세션 표시 — 이 페이지의 세션만 조회해 머신 종류를 뽑는다.
  // 시뮬은 스테이션이 8개라 머신 세그먼트가 있어도 에르그 전용 기록이 아니므로,
  // 세그먼트가 머신 하나뿐인 세션만 에르그로 본다(단독 기록·WOD 에르그 항목).
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

  // 필터를 유지하며 쿼리스트링 구성 (필터 변경 시 page 리셋)
  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    const merged = { source, period, type, ...over };
    if (merged.source !== "all") p.set("source", merged.source);
    if (merged.period !== "all") p.set("period", merged.period);
    if (merged.type !== "all") p.set("type", merged.type);
    if (over.page) p.set("page", over.page);
    const s = p.toString();
    return s ? `/sessions?${s}` : "/sessions";
  };

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs transition ${
      active
        ? "border-accent text-accent"
        : "border-muted/30 text-muted hover:border-foreground"
    }`;

  return (
    <main>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("sessions.title")}</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/sessions/compare"
            className="rounded-md border border-muted/30 px-4 py-2 text-sm font-semibold text-muted hover:border-foreground hover:text-foreground"
          >
            {t("compare.title")}
          </Link>
          <Link
            href="/sessions/new"
            className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-background hover:brightness-110"
          >
            {t("sessions.record")}
          </Link>
        </div>
      </div>
      <div className="mt-1 flex items-center justify-between gap-3">
        <p className="text-sm text-muted">{t("sessions.total", { n: total })}</p>
        {total > 0 && <ExportButton kind="sessions" />}
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted">{t("sessions.fltSource")}</span>
          {SOURCES.map((s) => (
            <Link key={s} href={qs({ source: s })} className={chip(source === s)}>
              {s === "all"
                ? t("sessions.fltAll")
                : t(`source.${s}` as Parameters<typeof t>[0])}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted">{t("sessions.fltPeriod")}</span>
          {PERIODS.map((p) => (
            <Link key={p} href={qs({ period: p })} className={chip(period === p)}>
              {p === "all"
                ? t("sessions.fltAll")
                : t(`sessions.period.${p}` as Parameters<typeof t>[0])}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted">{t("sessions.fltType")}</span>
          {TYPES.map((ty) => (
            <Link key={ty} href={qs({ type: ty })} className={chip(type === ty)}>
              {ty === "all"
                ? t("sessions.fltAll")
                : ty === "sim"
                  ? t("sessions.typeSim")
                  : t("sessions.typeErg")}
            </Link>
          ))}
        </div>
      </div>

      {!sessions?.length ? (
        <p className="mt-6 rounded-md bg-surface px-4 py-10 text-center text-sm text-muted">
          {total === 0 && (source !== "all" || period !== "all" || type !== "all")
            ? t("sessions.emptyFiltered")
            : t("sessions.empty")}
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {sessions.map((s) => {
            const raceRaw = (s as { race_results?: unknown }).race_results;
            const race = (Array.isArray(raceRaw) ? raceRaw[0] : raceRaw) as
              | {
                  event: string | null;
                  event_date: string | null;
                  season: string | null;
                  division: string | null;
                }
              | null
              | undefined;
            const isRace = !!race;
            const erg = ergMachine.get(s.id) ?? null;
            const div = isRace ? race?.division : s.division;
            const divLabel = div
              ? t(`division.${div}` as Parameters<typeof t>[0])
              : null;
            return (
              <li key={s.id}>
                <Link
                  href={`/sessions/${s.id}`}
                  className={`flex items-center justify-between rounded-md px-4 py-3.5 ${
                    isRace
                      ? "bg-accent/10 ring-1 ring-accent/30 hover:bg-accent/15"
                      : "bg-surface hover:bg-surface/70"
                  }`}
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    {isRace ? (
                      <>
                        <span className="flex items-center gap-2 text-sm font-semibold">
                          <span className="truncate">{race?.event}</span>
                          <span className="shrink-0 rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
                            {t("sessions.race")}
                          </span>
                        </span>
                        <span className="text-xs text-muted">
                          {race?.event_date
                            ? formatDate(race.event_date, tag, tz)
                            : formatDate(s.started_at, tag, tz)}
                          {race?.season ? ` · ${race.season}` : ""}
                          {divLabel ? ` · ${divLabel}` : ""}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="flex items-center gap-2 text-sm">
                          <span className="truncate">
                            {formatDate(s.started_at, tag, tz)}
                          </span>
                          {erg && (
                            <span className="shrink-0 rounded-full bg-track/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-track">
                              ⚡ {ergLabel(erg)}
                            </span>
                          )}
                        </span>
                        <span className="text-xs text-muted">
                          {t(`source.${s.source_device}` as Parameters<typeof t>[0])}
                          {divLabel ? ` · ${divLabel}` : ""}
                          {s.analysis_status !== "done" &&
                            ` · ${t("common.analysisPending")}`}
                        </span>
                      </>
                    )}
                  </div>
                  <span className="shrink-0 font-mono text-lg font-semibold">
                    {formatMs(s.total_time_ms)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {lastPage > 1 && (
        <nav className="mt-6 flex justify-center gap-4 text-sm">
          {page > 1 && (
            <Link href={qs({ page: String(page - 1) })} className="text-accent">
              {t("sessions.pagePrev")}
            </Link>
          )}
          <span className="text-muted">
            {page} / {lastPage}
          </span>
          {page < lastPage && (
            <Link href={qs({ page: String(page + 1) })} className="text-accent">
              {t("sessions.pageNext")}
            </Link>
          )}
        </nav>
      )}
    </main>
  );
}
