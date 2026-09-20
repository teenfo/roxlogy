import Link from "next/link";
import {
  Activity,
  ArrowRight,
  ChevronRight,
  Dumbbell,
  Flag,
  Plus,
  Target,
} from "lucide-react";
import { AiInsight } from "@/components/ai-insight";
import { createClient } from "@/lib/supabase/server";
import { getCachedProfile, getCachedUser } from "@/lib/supabase/auth";
import { getRaceBenchmarks } from "@/lib/cache";
import { getT } from "@/lib/i18n";
import {
  formatDate,
  formatDateShort,
  formatDateShortYear,
  formatMs,
  programDayNumber,
  todayISOIn,
  todayMidnightIn,
} from "@/lib/format";
import { STATIONS } from "@/lib/hyrox";
import { CorrelationLine, TrendBars } from "@/components/charts";
import { RehearsalReport } from "@/components/rehearsal-report";
import { PercentileBar } from "@/components/percentile-bar";
import { percentileOf, type Benchmark } from "@/lib/percentile";
import { RowLink } from "@/components/row-link";
import { Button } from "@/components/ui/button";
import { DataTable, PageHead, Panel, RecordRow } from "@/components/rox/ui";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.dashboard") };
}

/**
 * 대시보드 — 시안 dashboard.tsx 그대로 (PORT_PLAN §3-b):
 * PageHead · rx-stats 4 · [rx-race-feature | 오늘의 훈련] · [최근 기록 | 다음 목표].
 * 시안에 없는 우리 위젯(크루 일정·스테이션 최고·추이·훈련 vs 레이스·리허설·AI·백분위)은
 * 그 아래 Panel 로만 감싼다(§4-1 — 캡쳐 보고 대상).
 */
export default async function DashboardPage() {
  const supabase = await createClient();
  const { t, tag, tz } = await getT();
  const user = await getCachedUser();

  const [
    profile,
    { data: sessions },
    { data: stationSegs },
    { data: simSessions },
    { data: races },
    { data: goals },
    benchmarks,
    { data: enrollment },
    { data: nextPlans },
    { data: raceSessions },
  ] = await Promise.all([
    getCachedProfile(), // 레이아웃과 공유 — 요청당 1회만 조회

    supabase
      .from("sessions")
      .select("id, started_at, total_time_ms, source_device, template_id, division, race_results ( event, event_date, division )")
      .eq("user_id", user!.id)
      .is("deleted_at", null)
      .order("started_at", { ascending: false })
      .limit(60),
    // 주의: shared 세션 세그먼트는 RLS 로 전체 공개(피드용) — 본인 필터 필수
    supabase
      .from("session_segments")
      .select(
        "exercise_id, split_time_ms, sessions!inner ( user_id, deleted_at, started_at )",
      )
      .eq("kind", "station")
      .not("split_time_ms", "is", null)
      .eq("sessions.user_id", user!.id)
      .is("sessions.deleted_at", null),
    // 레이스 시뮬(스테이션 포함) 세션만 — 상관 차트·리허설 대비용
    supabase
      .from("sessions")
      .select(
        "id, started_at, total_time_ms, session_segments!inner ( kind, exercise_id, split_time_ms )",
      )
      .eq("user_id", user!.id)
      .is("deleted_at", null)
      .eq("session_segments.kind", "station")
      .order("started_at", { ascending: false })
      .limit(12),
    supabase
      .from("race_results")
      .select("id, event, event_date, division, total_time_ms")
      .eq("user_id", user!.id)
      .order("event_date", { ascending: true })
      .limit(30),
    supabase
      .from("goal_plans")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20),
    getRaceBenchmarks(),
    supabase
      .from("program_enrollments")
      .select(
        `start_date, repeat, end_date,
         programs ( id, title,
           program_days ( day_index, focus,
             workout_templates ( id, title, type ) ) )`,
      )
      .eq("active", true),
    // 다음 레이스 — 내 레이스 계획 중 가장 가까운 것
    supabase
      .from("race_plans")
      .select("id, title, race_date")
      .eq("user_id", user!.id)
      .gte("race_date", todayISOIn(tz))
      .order("race_date")
      .limit(1),
    // 최근 레이스에 연결된 세션의 구간 — 런/스테이션/그 외 비율
    supabase
      .from("sessions")
      .select("race_result_id, session_segments ( kind, split_time_ms )")
      .eq("user_id", user!.id)
      .is("deleted_at", null)
      .not("race_result_id", "is", null)
      .order("started_at", { ascending: false })
      .limit(3),
  ]);

  const all = sessions ?? [];
  const recent = all.slice(0, 3);

  // 크루 일정: 내 활성 크루의 다가오는 14일 (모임·대회·프로그램)
  type CrewCalRow = {
    kind: "meetup" | "race" | "program";
    on_date: string;
    starts_at: string | null;
    title: string;
    member_name: string | null;
    going_count: number | null;
    my_status: string | null;
  };
  const { data: myCrews } = await supabase
    .from("crew_members")
    .select("crews ( slug, name )")
    .eq("user_id", user!.id)
    .eq("status", "active")
    .limit(3);
  type CrewRef = { slug: string; name: string };
  const crewRefs = (myCrews ?? [])
    .map((m) => (Array.isArray(m.crews) ? m.crews[0] : m.crews) as CrewRef | null)
    .filter((c): c is CrewRef => !!c?.slug);
  // react-hooks/purity: 렌더 중 Date.now() 호출을 막는다 — 기준 시각 하나에서 파생.
  const agendaBase = new Date();
  const agendaFrom = agendaBase.toISOString().slice(0, 10);
  const agendaTo = new Date(agendaBase.getTime() + 14 * 86400000)
    .toISOString()
    .slice(0, 10);
  const crewAgenda: { crew: CrewRef; rows: CrewCalRow[] }[] = [];
  for (const c of crewRefs.slice(0, 2)) {
    const { data: calRows } = await supabase.rpc("crew_calendar", {
      p_slug: c.slug,
      p_from: agendaFrom,
      p_to: agendaTo,
    });
    const rows = ((calRows ?? []) as CrewCalRow[]).slice(0, 5);
    if (rows.length) crewAgenda.push({ crew: c, rows });
  }

  // 최근 레이스 — races 는 event_date 오름차순
  const raceList = (races ?? []) as {
    id: string;
    event: string;
    event_date: string | null;
    division: string | null;
    total_time_ms: number | null;
  }[];
  const latestRace = raceList.length ? raceList[raceList.length - 1] : null;
  const bestRace = raceList.reduce<(typeof raceList)[number] | null>(
    (a, r) =>
      r.total_time_ms != null && (a == null || r.total_time_ms < a.total_time_ms!)
        ? r
        : a,
    null,
  );
  const bms = (benchmarks ?? []) as Benchmark[];
  const latestRacePct = latestRace
    ? percentileOf(
        latestRace.total_time_ms,
        latestRace.division,
        profile?.gender ?? null,
        bms,
      )
    : null;
  // 최근 레이스의 런/스테이션/그 외 비율 — 연결된 세션의 구간에서
  type RaceSess = {
    race_result_id: string;
    session_segments: { kind: string; split_time_ms: number | null }[];
  };
  const linked = ((raceSessions ?? []) as RaceSess[]).find(
    (s) => latestRace && s.race_result_id === latestRace.id,
  );
  let split: { run: number; station: number; other: number } | null = null;
  if (linked && latestRace?.total_time_ms) {
    const sum = (kind: string) =>
      linked.session_segments
        .filter((s) => s.kind === kind)
        .reduce((a, s) => a + (s.split_time_ms ?? 0), 0);
    const run = sum("run");
    const station = sum("station");
    if (run > 0 || station > 0) {
      split = {
        run,
        station,
        other: Math.max(0, latestRace.total_time_ms - run - station),
      };
    }
  }
  const pct = (v: number) =>
    latestRace?.total_time_ms ? (v / latestRace.total_time_ms) * 100 : 0;
  const divisionLabel = (d: string | null) =>
    d ? t(`division.${d}` as Parameters<typeof t>[0]) : "";

  // 오늘의 운동: 활성 프로그램 등록 → 시작일 기준 오늘의 day_index 매핑
  type EnrollProgram = {
    start_date: string;
    repeat: boolean;
    end_date: string | null;
    programs: {
      id: string;
      title: string;
      program_days: {
        day_index: number;
        focus: string | null;
        workout_templates: { id: string; title: string; type: string }[];
      }[];
    } | null;
  };
  // 진행 중 프로그램은 여러 개일 수 있다(096) — maybeSingle 은 2건부터 에러를 낸다
  const enrolls = (enrollment ?? []) as unknown as EnrollProgram[];
  type TodayWorkout = {
    id: string;
    title: string;
    type: string;
    programTitle: string;
    done: boolean;
  };
  const todayWorkouts: TodayWorkout[] = [];
  let anyProgram = false;
  for (const enroll of enrolls) {
    if (!enroll.programs) continue;
    anyProgram = true;
    const start = new Date(enroll.start_date + "T00:00:00");
    // 서버는 UTC — 사용자 시간대(폴백 KST) 기준 오늘로 일차를 계산한다
    const nowMid = todayMidnightIn(tz);
    const daysSince = Math.floor((nowMid.getTime() - start.getTime()) / 86400000);
    const cycleLen = enroll.programs.program_days.reduce(
      (m, d) => Math.max(m, d.day_index),
      0,
    );
    // 종료 판정: 등록 종료일 경과 또는 일차 > 길이 = 완료 (반복은 종료일까지 순환)
    const pastEnd =
      !!enroll.end_date &&
      nowMid.getTime() > new Date(enroll.end_date + "T00:00:00").getTime();
    const dayNumber = pastEnd
      ? -1
      : (programDayNumber(daysSince, cycleLen, enroll.repeat) ?? -1);
    if (dayNumber >= 1 && dayNumber <= cycleLen) {
      const day = enroll.programs.program_days.find(
        (d) => d.day_index === dayNumber,
      );
      for (const w of day?.workout_templates ?? []) {
        todayWorkouts.push({
          ...w,
          programTitle: enroll.programs.title,
          done: all.some((s) => s.template_id === w.id),
        });
      }
    }
  }
  const doneCount = todayWorkouts.filter((w) => w.done).length;

  // 이번 주 세션 수 (스탯 보조 문구)
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const weekly = all.filter((s) => new Date(s.started_at) >= monday);

  // 다음 레이스 D-day
  const nextPlan = (nextPlans ?? [])[0] as
    | { id: string; title: string; race_date: string }
    | undefined;
  const dday = nextPlan
    ? Math.round(
        (new Date(`${nextPlan.race_date}T00:00:00`).getTime() -
          new Date(`${todayISOIn(tz)}T00:00:00`).getTime()) /
          86400000,
      )
    : null;

  // 다음 목표 — 가장 최근에 저장한 목표
  type Goal = {
    id: string;
    target_total_ms: number;
    run_total_ms: number | null;
    roxzone_total_ms: number | null;
    stations: { key: string; targetMs: number }[] | null;
    division: string | null;
    event_name: string | null;
    event_date: string | null;
  };
  const goalList = (goals ?? []) as Goal[];
  const nextGoal = goalList[0] ?? null;
  const goalStationMs = nextGoal?.stations?.reduce((a, s) => a + s.targetMs, 0) ?? 0;

  // 스테이션 최고
  const pr = new Map<string, number>();
  for (const seg of stationSegs ?? []) {
    if (!seg.exercise_id || seg.split_time_ms == null) continue;
    const cur = pr.get(seg.exercise_id);
    if (cur == null || seg.split_time_ms < cur)
      pr.set(seg.exercise_id, seg.split_time_ms);
  }
  const prs = STATIONS.map((s) => ({
    key: s.key,
    ms: pr.get(s.exerciseId) ?? null,
  }));
  const hasPr = prs.some((p) => p.ms != null);

  const trend = all
    .slice(0, 8)
    .reverse()
    .map((s) => ({
      name: formatDateShortYear(s.started_at, tag, tz),
      ms: s.total_time_ms ?? 0,
    }));

  // S16 훈련→레이스 상관 시계열: 시뮬 세션 총시간 + 레이스 총시간을 날짜축에 병합
  const sims = (simSessions ?? []) as {
    id: string;
    started_at: string;
    total_time_ms: number | null;
    session_segments: {
      kind: string;
      exercise_id: string | null;
      split_time_ms: number | null;
    }[];
  }[];
  const corrMap = new Map<
    string,
    { date: string; ts: number; sim: number | null; race: number | null }
  >();
  const put = (iso: string, key: "sim" | "race", ms: number | null) => {
    if (ms == null) return;
    const date = formatDateShortYear(iso, tag, tz);
    const cur = corrMap.get(date) ?? {
      date,
      ts: new Date(iso).getTime(),
      sim: null,
      race: null,
    };
    // 같은 날 여러 건이면 더 빠른(작은) 기록 채택
    cur[key] = cur[key] == null ? ms : Math.min(cur[key]!, ms);
    corrMap.set(date, cur);
  };
  for (const s of sims) put(s.started_at, "sim", s.total_time_ms);
  for (const r of races ?? [])
    if (r.event_date) put(r.event_date, "race", r.total_time_ms);
  const corr = [...corrMap.values()].sort((a, b) => a.ts - b.ts);
  const showCorr =
    corr.some((c) => c.sim != null) && corr.some((c) => c.race != null);

  // S17 리허설 리포트: 목표·세션을 골라 스테이션별로 대비 (클라이언트 드롭박스)
  const goalRows = goalList
    .filter((g) => Array.isArray(g.stations) && g.stations.length > 0)
    .map((g) => ({
      id: g.id,
      target: g.target_total_ms,
      division: g.division,
      eventName: g.event_name,
      eventDate: g.event_date,
      stations: g.stations!,
    }));
  const rehearsalSessions = sims
    .map((s) => {
      const stations: Record<string, number> = {};
      for (const seg of s.session_segments) {
        if (seg.kind !== "station" || !seg.exercise_id || seg.split_time_ms == null)
          continue;
        const st = STATIONS.find((x) => x.exerciseId === seg.exercise_id);
        if (st) stations[st.key] = seg.split_time_ms;
      }
      return {
        id: s.id,
        label: formatDateShortYear(s.started_at, tag, tz),
        total: s.total_time_ms,
        stations,
      };
    })
    .filter((s) => Object.keys(s.stations).length > 0);
  const showRehearsal = goalRows.length > 0 && rehearsalSessions.length > 0;

  // 오늘 날짜 블록 (시안 .rx-today-date)
  const todayMid = todayMidnightIn(tz);
  const weekdayShort = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: tz })
    .format(todayMid)
    .toUpperCase();
  const dayNum = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: tz }).format(todayMid);
  const todayLong = new Intl.DateTimeFormat(tag, {
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: tz,
  }).format(todayMid);

  const name = profile?.display_name ?? user!.email ?? "";
  const raceOf = (s: (typeof all)[number]) => {
    const rr = (s as { race_results?: unknown }).race_results;
    return (Array.isArray(rr) ? rr[0] : rr) as
      | { event: string | null; event_date: string | null; division: string | null }
      | null
      | undefined;
  };

  return (
    <>
      <PageHead
        title={t("dash.greeting")}
        description={t("dash.intro", { name })}
        action={
          <Button asChild className="rx-primary">
            <Link href="/sessions/new">
              <Plus size={17} />
              {t("dash.recordSession")}
            </Link>
          </Button>
        }
      />
      <div className="rx-stats">
        <div className="rx-stat">
          <span>{t("dash.totalSessions")}</span>
          <strong>{all.length}</strong>
          <p>
            {t("dash.weekSessions")} {weekly.length}
          </p>
        </div>
        <div className="rx-stat">
          <span>{t("dash.bestRace")}</span>
          <strong>{bestRace ? formatMs(bestRace.total_time_ms) : "—"}</strong>
          <p>{bestRace ? bestRace.event : t("dash.noRace")}</p>
        </div>
        <div className="rx-stat">
          <span>{t("dash.nextRace")}</span>
          <strong>{dday != null && dday >= 0 ? `D–${dday}` : "—"}</strong>
          <p>
            {nextPlan
              ? `${nextPlan.title} · ${formatDateShort(nextPlan.race_date, tag, tz)}`
              : t("sessions.noUpcoming")}
          </p>
        </div>
        <div className="rx-stat">
          <span>{t("dash.todayTitle")}</span>
          <strong>
            {doneCount} / {todayWorkouts.length}
          </strong>
          <p>
            {todayWorkouts.length
              ? [...new Set(todayWorkouts.map((w) => w.programTitle))].join(" · ")
              : anyProgram
                ? t("dash.todayRest")
                : t("dash.noProgram")}
          </p>
        </div>
      </div>

      <div className="rx-dashboard-grid">
        <Panel className="rx-race-feature">
          <div className="rx-panel-head">
            <span className="rx-eyebrow">LATEST RACE</span>
            <Link href="/races">
              {t("dash.allRaces")} <ArrowRight size={16} />
            </Link>
          </div>
          {latestRace ? (
            <>
              <div className="rx-feature-line">
                <div>
                  {latestRace.division && (
                    <span className="rx-tag">{divisionLabel(latestRace.division)}</span>
                  )}
                  <h2>{latestRace.event}</h2>
                  <p>
                    {latestRace.event_date
                      ? formatDateShort(latestRace.event_date, tag, tz)
                      : ""}
                    {latestRace.division ? ` · ${divisionLabel(latestRace.division)}` : ""}
                  </p>
                </div>
                <div className="rx-race-time">
                  <strong>{formatMs(latestRace.total_time_ms)}</strong>
                  <span>{t("dash.officialTime")}</span>
                </div>
              </div>
              {split && (
                <>
                  <div className="rx-race-split">
                    <span style={{ width: `${pct(split.run)}%`, background: "#ffd500" }} />
                    <span style={{ width: `${pct(split.station)}%`, background: "#899cd4" }} />
                    <span style={{ width: `${pct(split.other)}%`, background: "#53606b" }} />
                  </div>
                  <div className="rx-split-labels">
                    <span>
                      <i style={{ background: "#ffd500" }} />
                      {t("landing.m.run")} <b>{formatMs(split.run)}</b>
                    </span>
                    <span>
                      <i style={{ background: "#899cd4" }} />
                      {t("landing.m.station")} <b>{formatMs(split.station)}</b>
                    </span>
                    <span>
                      <i style={{ background: "#53606b" }} />
                      {t("dash.other")} <b>{formatMs(split.other)}</b>
                    </span>
                  </div>
                </>
              )}
              <Link className="rx-feature-link" href={`/races/${latestRace.id}`}>
                {t("dash.analyzeSplits")} <ArrowRight size={18} />
              </Link>
            </>
          ) : (
            <div className="rx-feature-line">
              <div>
                <h2>{t("dash.noRace")}</h2>
                <p>{t("dash.noRaceHint")}</p>
              </div>
            </div>
          )}
        </Panel>
        <Panel
          title={t("dash.todayTitle")}
          action={
            <Link href="/schedule">
              {t("dash.weekSchedule")} <ArrowRight size={16} />
            </Link>
          }
        >
          <div className="rx-today-date">
            <span>{weekdayShort}</span>
            <strong>{dayNum}</strong>
            <p>
              {todayLong}
              <br />
              <small>
                {todayWorkouts.length
                  ? t("dash.todayN", { n: todayWorkouts.length })
                  : anyProgram
                    ? t("dash.todayRest")
                    : t("dash.noProgram")}
              </small>
            </p>
          </div>
          {todayWorkouts.map((w) => (
            <RowLink className="rx-workout-row" key={w.id} href={`/workouts/${w.id}`}>
              <span className="rx-workout-icon">
                <Dumbbell size={18} />
              </span>
              <span>
                <b>{w.title}</b>
                <small>
                  {w.programTitle} ·{" "}
                  {t(`programs.type.${w.type}` as Parameters<typeof t>[0])}
                  {w.done ? ` · ${t("dash.todayDone")}` : ""}
                </small>
              </span>
              <ChevronRight size={16} />
            </RowLink>
          ))}
          {!todayWorkouts.length && (
            <div className="rx-workout-row">
              <span className="rx-workout-icon">
                <Dumbbell size={18} />
              </span>
              <span>
                <b>{anyProgram ? t("dash.todayRest") : t("dash.noProgram")}</b>
                <small>
                  <Link href="/programs">{t("nav.programs")}</Link>
                </small>
              </span>
            </div>
          )}
        </Panel>
      </div>

      <div className="rx-dashboard-grid">
        <Panel
          title={t("dash.recentTitle")}
          action={
            <Link href="/sessions">
              {t("dash.allSessions")} <ArrowRight size={16} />
            </Link>
          }
        >
          {recent.length ? (
            recent.map((s) => {
              const race = raceOf(s);
              return (
                <RowLink className="rx-record-row" href={`/sessions/${s.id}`} key={s.id}>
                  <span className="rx-workout-icon">
                    {race ? <Flag size={17} /> : <Activity size={17} />}
                  </span>
                  <span>
                    <b>{race?.event ?? formatDate(s.started_at, tag, tz)}</b>
                    <small>
                      {[
                        divisionLabel(race?.division ?? s.division ?? null),
                        formatDateShort(s.started_at, tag, tz),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </span>
                  <strong>{formatMs(s.total_time_ms)}</strong>
                  <ChevronRight size={16} />
                </RowLink>
              );
            })
          ) : (
            <div className="rx-record-row">
              <span>
                <b>{t("dash.empty")}</b>
                <small>
                  <Link href="/sessions/new">{t("dash.recordFirst")}</Link>
                </small>
              </span>
            </div>
          )}
        </Panel>
        <Panel title={t("dash.nextGoal")} action={<Target size={18} />}>
          <div className="rx-target">
            {nextGoal ? (
              <>
                <span className="rx-tag">
                  {[nextGoal.event_name, divisionLabel(nextGoal.division)]
                    .filter(Boolean)
                    .join(" · ") || t("goals.noEvent")}
                </span>
                <h3>{formatMs(nextGoal.target_total_ms)}</h3>
                <p>
                  {t("landing.m.run")} {formatMs(nextGoal.run_total_ms)} ·{" "}
                  {t("landing.m.station")} {formatMs(goalStationMs || null)} ·{" "}
                  {t("landing.m.roxzone")} {formatMs(nextGoal.roxzone_total_ms)}
                </p>
                <Button asChild variant="outline">
                  <Link href={`/predict?goal=${nextGoal.id}`}>
                    {t("dash.adjustGoal")} <ArrowRight size={16} />
                  </Link>
                </Button>
              </>
            ) : (
              <>
                <span className="rx-tag">{t("goals.empty")}</span>
                <p>{t("goals.desc")}</p>
                <Button asChild variant="outline">
                  <Link href="/predict">
                    {t("dash.makeGoal")} <ArrowRight size={16} />
                  </Link>
                </Button>
              </>
            )}
          </div>
        </Panel>
      </div>

      {/* ── 시안에 없는 위젯 (PORT_PLAN §4-1) — Panel 로만 감싼다 ── */}
      {latestRace && latestRacePct != null && latestRace.division && (
        <PercentileBar
          pct={latestRacePct}
          division={latestRace.division}
          gender={profile?.gender ?? null}
          heading={t("dash.latestRaceTitle")}
          link={{ href: `/races/${latestRace.id}`, label: latestRace.event }}
        />
      )}

      {crewAgenda.length > 0 && (
        <div className="rx-dashboard-grid">
          {crewAgenda.map(({ crew, rows }) => (
            <Panel
              key={crew.slug}
              title={`${t("dash.crewSched")} · ${crew.name}`}
              action={
                <Link href={`/crews/${crew.slug}/schedule`}>
                  {t("dash.viewAll")} <ArrowRight size={16} />
                </Link>
              }
            >
              {rows.map((r, i) => (
                <RecordRow
                  key={`${r.kind}-${r.on_date}-${i}`}
                  href={`/crews/${crew.slug}/schedule`}
                  title={r.title}
                  note={`${new Date(`${r.on_date}T00:00:00`).toLocaleDateString(tag, {
                    month: "short",
                    day: "numeric",
                    weekday: "short",
                  })} · ${
                    {
                      meetup: t("crew.schedKindMeetup"),
                      race: t("crew.schedKindRace"),
                      program: t("crew.schedKindProgram"),
                    }[r.kind] ?? r.kind
                  }${r.kind === "race" && r.member_name ? ` · ${r.member_name}` : ""}`}
                  end={
                    r.kind === "meetup"
                      ? `✓ ${r.going_count ?? 0}${r.my_status === "going" ? ` · ${t("crew.rsvpGoing")}` : ""}`
                      : undefined
                  }
                />
              ))}
            </Panel>
          ))}
        </div>
      )}

      {hasPr && (
        <Panel title={t("dash.prTitle")}>
          <DataTable
            headers={[t("dash.rehStation"), t("sessions.pb")]}
            rows={prs
              .filter((p) => p.ms != null)
              .map((p) => [
                t(`station.${p.key}` as Parameters<typeof t>[0]),
                <strong className="rx-number" key={p.key}>
                  {formatMs(p.ms)}
                </strong>,
              ])}
          />
        </Panel>
      )}

      {trend.length >= 2 && (
        <Panel title={t("dash.trendTitle")}>
          <div>
            <TrendBars data={trend} />
          </div>
        </Panel>
      )}

      {showRehearsal && (
        <Panel>
          <div>
            <RehearsalReport goals={goalRows} sessions={rehearsalSessions} />
          </div>
        </Panel>
      )}

      {showCorr && (
        <Panel title={t("dash.corrTitle")}>
          <div>
            <p className="rx-hint" style={{ marginBottom: 12 }}>
              {t("dash.corrDesc")}
            </p>
            <CorrelationLine
              data={corr}
              simLabel={t("dash.corrSim")}
              raceLabel={t("dash.corrRace")}
            />
          </div>
        </Panel>
      )}

      <AiInsight kind="weekly" />
    </>
  );
}
