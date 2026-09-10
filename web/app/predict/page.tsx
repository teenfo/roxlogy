import { getT } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { STATIONS } from "@/lib/hyrox";
import { formatDateShort } from "@/lib/format";
import { getRaceBenchmarks } from "@/lib/cache";
import { hyroxAgeGroup, type Benchmark } from "@/lib/percentile";
import {
  PredictForm,
  type PredictSession,
  type EditGoal,
} from "@/components/predict-form";
import { todayISOIn } from "@/lib/format";
import type { RunFitness } from "@/lib/run";
import { GlobalNav } from "@/components/global-nav";
import { MobileTabBar } from "@/components/mobile-tabbar";

const EX_TO_KEY = new Map(STATIONS.map((s) => [s.exerciseId, s.key]));

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.predict"), description: t("predict.desc") };
}

export default async function PredictPage({
  searchParams,
}: {
  searchParams: Promise<{
    event?: string;
    date?: string;
    division?: string;
    goal?: string;
  }>;
}) {
  const sp = await searchParams;
  const { tag, tz } = await getT();
  const supabase = await createClient();
  const user = await getCachedUser();

  // 로그인 시: 최근 레이스 시뮬 세션을 목표 계산용으로 불러온다.
  let sessions: PredictSession[] = [];
  let isAdmin = false;
  let displayName: string | null = null;
  const unread = 0;
  let gender: string | null = null;
  let ageGroup: string | null = null;
  let editGoal: EditGoal | null = null;
  // 목표 랩 페이스가 내 러닝으로 가능한지 판정하는 재료
  let runFitness: RunFitness | null = null;
  // 실측 백분위 분포 (공개 집계 — 비로그인도 표시)
  const benchmarks = await getRaceBenchmarks();
  // 목표 대회 선택용 — 다가오는 공식 대회 (공개 테이블)
  const { data: upcoming } = await supabase
    .from("race_events")
    .select("id, name, city, start_date")
    .gte("start_date", todayISOIn(tz))
    .order("start_date")
    .limit(50);
  if (user) {
    if (sp.goal) {
      const { data: g } = await supabase
        .from("goal_plans")
        .select(
          "id, target_total_ms, level, division, event_name, event_date, run_total_ms, roxzone_total_ms, stations",
        )
        .eq("id", sp.goal)
        .maybeSingle();
      if (g) editGoal = g as EditGoal;
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_admin, gender, birth_year, display_name")
      .eq("id", user.id)
      .maybeSingle();
    isAdmin = profile?.is_admin === true;
    displayName = (profile?.display_name as string | null) ?? null;
    gender = (profile?.gender as string | null) ?? null;
    ageGroup = hyroxAgeGroup(profile?.birth_year as number | null);
    const { data: rows } = await supabase
      .from("sessions")
      .select(
        "id, started_at, total_time_ms, session_segments ( kind, exercise_id, split_time_ms )",
      )
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .order("started_at", { ascending: false })
      .limit(30);
    sessions = (rows ?? [])
      .map((s) => {
        const segs = (s.session_segments ?? []) as {
          kind: string;
          exercise_id: string | null;
          split_time_ms: number | null;
        }[];
        const stations: Record<string, number> = {};
        let runTotalMs = 0;
        let roxTotalMs = 0;
        for (const seg of segs) {
          if (seg.split_time_ms == null) continue;
          if (seg.kind === "station" && seg.exercise_id) {
            const key = EX_TO_KEY.get(seg.exercise_id);
            if (key) stations[key] = seg.split_time_ms;
          } else if (seg.kind === "run") runTotalMs += seg.split_time_ms;
          else if (seg.kind === "roxzone") roxTotalMs += seg.split_time_ms;
        }
        return {
          id: s.id,
          label: formatDateShort(s.started_at, tag, tz),
          total: s.total_time_ms ?? 0,
          stations,
          runTotalMs,
          roxTotalMs,
        };
      })
      .filter((s) => Object.keys(s.stations).length > 0);

    // 러닝 기준선 + 내 평소 저하율 → 목표 랩의 현실성 판정에 쓴다.
    // 두 RPC 모두 auth.uid() 로 본인 것만 본다.
    const [{ data: baseline }, { data: degradation }] = await Promise.all([
      supabase.rpc("run_1k_baseline", { p_as_of: todayISOIn(tz) }),
      supabase.rpc("my_run_degradation", {}),
    ]);
    const base = baseline as {
      baseline_1k_ms: number;
      from_distance_m: number;
      from_ran_on: string;
    } | null;
    const deg = degradation as {
      degradation_pct: number;
      sessions: number;
    } | null;
    if (base) {
      runFitness = {
        baseline1kMs: base.baseline_1k_ms,
        fromDistanceM: base.from_distance_m,
        fromRanOn: base.from_ran_on,
        degradationPct: deg?.degradation_pct ?? null,
        degradationSessions: deg?.sessions ?? 0,
      };
    }
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line-soft bg-[var(--nav)]">
        {/* 앱과 같은 글로벌 네비 — 비로그인이면 로그인 버튼으로 바뀐다 */}
        <GlobalNav
          isAdmin={isAdmin}
          displayName={user ? (displayName ?? "Athlete") : null}
          unread={unread}
          loginNext="/predict"
        />
      </header>
      <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-8 max-md:px-4 max-md:pb-28">
        <PredictForm
          isLoggedIn={!!user}
          sessions={sessions}
          runFitness={runFitness}
          eventName={editGoal?.event_name ?? sp.event ?? null}
          eventDate={editGoal?.event_date ?? sp.date ?? null}
          initialDivision={sp.division ?? null}
          editGoal={editGoal}
          benchmarks={benchmarks as Benchmark[]}
          gender={gender}
          ageGroup={ageGroup}
          upcomingEvents={
            (upcoming ?? []) as {
              id: string;
              name: string;
              city: string;
              start_date: string;
            }[]
          }
        />
      </div>
      {user && <MobileTabBar />}
    </>
  );
}
