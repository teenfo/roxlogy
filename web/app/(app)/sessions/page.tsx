import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
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
const TYPES = ["all", "sim"] as const;
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
  const { t, tag } = await getT();

  // 시뮬만: 스테이션 세그먼트가 있는 세션 id를 선별해 일반 id 필터로 적용
  // (count/range와 호환되도록 일반 WHERE 절로 들어감)
  let simIds: string[] | null = null;
  if (type === "sim") {
    const { data: segRows } = await supabase
      .from("session_segments")
      .select("session_id")
      .eq("kind", "station");
    simIds = [...new Set((segRows ?? []).map((r) => r.session_id))];
  }

  let query = supabase
    .from("sessions")
    .select(
      `id, started_at, total_time_ms, source_device, analysis_status, division,
       race_results ( event, event_date, season, division )`,
      { count: "exact" },
    )
    .is("deleted_at", null);

  if (source !== "all") query = query.eq("source_device", source);
  const days = PERIOD_DAYS[period];
  if (days != null) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    query = query.gte("started_at", cutoff.toISOString());
  }
  if (simIds != null) query = query.in("id", simIds.length ? simIds : [""]);

  const { data: sessions, count } = await query
    .order("started_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  const total = count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
              {ty === "all" ? t("sessions.fltAll") : t("sessions.typeSim")}
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
                            ? formatDate(race.event_date, tag)
                            : formatDate(s.started_at, tag)}
                          {race?.season ? ` · ${race.season}` : ""}
                          {divLabel ? ` · ${divLabel}` : ""}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-sm">
                          {formatDate(s.started_at, tag)}
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
