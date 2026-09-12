import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { formatDate, formatMs, todayISOIn } from "@/lib/format";
import { Card, Chip } from "@/components/ui/crew-ui";
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
  // 개인 최고 = 대회 기록 중 최소. 대회가 없으면 요약을 띄우지 않는다
  // (시뮬 최소를 PB 라고 부르면 실제 대회 기록과 뒤섞인다)
  const pb = races.reduce<(typeof races)[number] | null>(
    (a, r) => (a == null || r.ms < a.ms ? r : a),
    null,
  );
  const raceAvg = races.length
    ? Math.round(races.reduce((a, r) => a + r.ms, 0) / races.length)
    : null;
  const latest = (latestRows ?? [])[0] as
    | { id: string; total_time_ms: number; started_at: string }
    | undefined;
  // 시즌 = 데이터에 있는 가장 최근 시즌 문자열 (규칙을 새로 만들지 않는다)
  const seasons = [...new Set(races.map((r) => r.season).filter(Boolean))].sort();
  const curSeason = seasons[seasons.length - 1] ?? null;
  const seasonRaces = curSeason
    ? races.filter((r) => r.season === curSeason).length
    : 0;
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

  const gapLabel = (ms: number) => {
    const d = Math.round(ms / 1000);
    const sign = d >= 0 ? "+" : "−";
    const a = Math.abs(d);
    return `${sign}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`;
  };
  const srcIcon: Record<string, string> = { web: "▯", watch: "◔", phone: "▮" };

  return (
    <main className="flex flex-col gap-[22px]">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            {t("sessions.title")}
          </h1>
          <p className="mt-1 text-[15px] text-muted">
            {t("sessions.total", { n: total })}
            {races.length > 0 && (
              <>
                {" · "}
                {t("sessions.race")}{" "}
                <b className="font-bold text-foreground">{races.length}</b>
              </>
            )}
            {simIds.length > 0 && (
              <>
                {" · "}
                {t("sessions.typeSim")}{" "}
                <b className="font-bold text-foreground">{simIds.length}</b>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {total > 0 && <ExportButton kind="sessions" />}
          <Link
            href="/sessions/compare"
            className="flex h-10 items-center rounded-lg border border-line-strong bg-control px-4 text-sm font-semibold text-foreground/80 hover:border-muted/60"
          >
            {t("compare.title")}
          </Link>
          <Link
            href="/sessions/new"
            className="flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-extrabold text-background hover:brightness-110"
          >
            + {t("sessions.record")}
          </Link>
        </div>
      </div>

      {/* 요약 4카드 — 대회 기록이 있을 때만 (PB 는 대회 기준) */}
      {pb && (
        <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Card highlight className="px-4 py-3.5">
            <p className="text-xs text-[#c9b34a]">{t("sessions.pb")}</p>
            <p className="tabular mt-1 text-[22px] font-extrabold text-accent">
              {formatMs(pb.ms)}
            </p>
            <p className="mt-0.5 truncate text-xs text-[#8a7a2a]">
              {[pb.event, pb.division && t(`division.${pb.division}` as Parameters<typeof t>[0])]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </Card>
          <Card className="px-4 py-3.5">
            <p className="text-xs text-muted">{t("sessions.latest")}</p>
            <p className="tabular mt-1 text-[22px] font-extrabold">
              {latest ? formatMs(latest.total_time_ms) : "—"}
            </p>
            {latest && (
              <p
                className={`tabular mt-0.5 text-xs ${
                  latest.total_time_ms <= pb.ms ? "text-success" : "text-danger"
                }`}
              >
                PB {gapLabel(latest.total_time_ms - pb.ms)}
              </p>
            )}
          </Card>
          <Card className="px-4 py-3.5">
            <p className="text-xs text-muted">{t("sessions.raceAvg")}</p>
            <p className="tabular mt-1 text-[22px] font-extrabold">
              {raceAvg ? formatMs(raceAvg) : "—"}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {t("sessions.raceFinishes", { n: races.length })}
            </p>
          </Card>
          <Card className="px-4 py-3.5">
            <p className="text-xs text-muted">
              {curSeason ? curSeason : t("sessions.season")}
            </p>
            <p className="tabular mt-1 text-[22px] font-extrabold">
              {seasonRaces}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted">
              {nextPlan && dday != null
                ? `${nextPlan.title} D-${dday}`
                : t("sessions.noUpcoming")}
            </p>
          </Card>
        </section>
      )}

      {/* 필터 바 */}
      <Card className="flex flex-wrap items-center gap-2 px-3.5 py-3">
        <span className="text-xs text-muted">{t("sessions.fltSource")}</span>
        {SOURCES.map((sc) => (
          <Chip key={sc} href={qs({ source: sc })} active={source === sc}>
            {sc === "all"
              ? t("sessions.fltAll")
              : t(`source.${sc}` as Parameters<typeof t>[0])}
          </Chip>
        ))}
        <span aria-hidden className="mx-2 h-5 w-px bg-line-mid" />
        <span className="text-xs text-muted">{t("sessions.fltPeriod")}</span>
        {PERIODS.map((pr) => (
          <Chip key={pr} href={qs({ period: pr })} active={period === pr}>
            {pr === "all"
              ? t("sessions.fltAll")
              : t(`sessions.period.${pr}` as Parameters<typeof t>[0])}
          </Chip>
        ))}
        <span aria-hidden className="mx-2 h-5 w-px bg-line-mid" />
        <span className="text-xs text-muted">{t("sessions.fltType")}</span>
        {TYPES.map((ty) => (
          <Chip key={ty} href={qs({ type: ty })} active={type === ty}>
            {ty === "all"
              ? t("sessions.fltAll")
              : ty === "sim"
                ? t("sessions.typeSim")
                : t("sessions.typeErg")}
          </Chip>
        ))}
        <span className="ml-auto text-[13px] text-muted">
          {t("sessions.shownN", { n: total })}
        </span>
      </Card>

      {/* 목록 */}
      {!sessions?.length ? (
        <Card className="px-4 py-10 text-center">
          <p className="text-sm text-muted">
            {total === 0 && (source !== "all" || period !== "all" || type !== "all")
              ? t("sessions.emptyFiltered")
              : t("sessions.empty")}
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {sessions.map((sess) => {
            const raceRaw = (sess as { race_results?: unknown }).race_results;
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
            const erg = ergMachine.get(sess.id) ?? null;
            const div = isRace ? race?.division : sess.division;
            const divLabel = div
              ? t(`division.${div}` as Parameters<typeof t>[0])
              : null;
            const isPb = !!pb && sess.id === pb.id;
            const ms = sess.total_time_ms;
            const d = new Date(sess.started_at);
            const gap = pb && ms != null && !isPb ? ms - pb.ms : null;

            return (
              <li key={sess.id}>
                <Link
                  href={`/sessions/${sess.id}`}
                  className={`grid grid-cols-[68px_minmax(0,1fr)_auto] items-center gap-4 rounded-2xl border px-4 py-3.5 transition-colors max-sm:grid-cols-[68px_minmax(0,1fr)] ${
                    isPb
                      ? "border-line-accent bg-highlight"
                      : "border-line bg-card hover:border-muted/50"
                  }`}
                >
                  {/* 날짜 블록 */}
                  <span className="border-r border-line-mid pr-3.5 text-center">
                    <span className="block text-xs font-semibold text-muted">
                      {d.getFullYear()}
                    </span>
                    <span
                      className={`tabular block text-xl font-extrabold ${isPb ? "text-accent" : ""}`}
                    >
                      {d.getMonth() + 1}/{d.getDate()}
                    </span>
                  </span>

                  {/* 본문 */}
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[17px] font-bold">
                        {isRace
                          ? race?.event
                          : formatDate(sess.started_at, tag, tz)}
                      </span>
                      {isRace ? (
                        <span className="shrink-0 rounded-md bg-[#2a2500] px-2 py-0.5 text-xs font-bold text-accent-dim">
                          {t("sessions.race")}
                        </span>
                      ) : erg ? (
                        <span className="shrink-0 rounded-md bg-info-bg px-2 py-0.5 text-xs font-bold text-info">
                          ⚡ {ergLabel(erg)}
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-md bg-label-bg px-2 py-0.5 text-xs font-bold text-label">
                          {t("sessions.typeSim")}
                        </span>
                      )}
                      {isPb && (
                        <span className="shrink-0 rounded-md bg-accent px-2 py-0.5 text-xs font-extrabold text-background">
                          PB
                        </span>
                      )}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 text-[13px] text-muted">
                      {divLabel && (
                        <span className="rounded bg-label-bg px-1.5 py-0.5 text-xs font-bold uppercase tracking-wide text-label">
                          {divLabel}
                        </span>
                      )}
                      {isRace && race?.season && <span>{race.season}</span>}
                      <span className="flex items-center gap-1">
                        <span aria-hidden className="text-xs">
                          {srcIcon[sess.source_device] ?? "▯"}
                        </span>
                        {t(`source.${sess.source_device}` as Parameters<typeof t>[0])}
                      </span>
                      {sess.analysis_status !== "done" && (
                        <span>{t("common.analysisPending")}</span>
                      )}
                    </span>
                  </span>

                  {/* 기록 */}
                  <span className="text-right max-sm:col-span-2 max-sm:mt-1 max-sm:text-left">
                    <span
                      className={`tabular block text-2xl font-extrabold ${isPb ? "text-accent" : ""}`}
                    >
                      {formatMs(ms)}
                    </span>
                    <span
                      className={`tabular mt-0.5 block text-xs ${
                        isPb
                          ? "text-accent"
                          : gap != null && gap > 1_800_000
                            ? "text-danger"
                            : "text-muted"
                      }`}
                    >
                      {isPb
                        ? t("sessions.pb")
                        : gap != null
                          ? `PB ${gapLabel(gap)}`
                          : ""}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {lastPage > 1 && (
        <nav className="flex justify-center gap-4 text-sm">
          {page > 1 && (
            <Link href={qs({ page: String(page - 1) })} className="text-accent">
              {t("sessions.pagePrev")}
            </Link>
          )}
          <span className="tabular text-muted">
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
