import { Plus } from "lucide-react";
import { AiProgramButton } from "@/components/ai-program-button";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { programDayNumber, todayISOIn } from "@/lib/format";
import { ProgramFinder, type ProgramCardData } from "@/components/program-finder";
import { Go, PageHead } from "@/components/rox/ui";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.programs") };
}

type Program = {
  id: string;
  owner_id: string | null;
  title: string;
  description: string | null;
  weeks: number | null;
  level: string | null;
  is_public: boolean;
  created_at: string;
};

type DayRow = {
  program_id: string;
  day_index: number;
  workout_templates: { id: string; title: string; type: string | null }[];
};

type ActiveEnroll = {
  start_date: string;
  end_date: string | null;
  repeat: boolean;
  programs: {
    id: string;
    title: string;
    level: string | null;
    weeks: number | null;
  } | null;
};

export default async function ProgramsPage() {
  const supabase = await createClient();
  const { t, tz } = await getT();
  const user = await getCachedUser();

  // 공용(is_public) 또는 본인 소유만 — 관리자는 RLS 로 전체가 보이므로 명시 필터
  const { data: programRows } = await supabase
    .from("programs")
    .select("id, owner_id, title, description, weeks, level, is_public, created_at")
    .or(`is_public.eq.true,owner_id.eq.${user!.id}`)
    .order("created_at", { ascending: false });
  const programs = (programRows ?? []) as Program[];
  const ids = programs.map((p) => p.id);

  const [{ data: dayRows }, { data: enrollRow }] = await Promise.all([
    ids.length
      ? supabase
          .from("program_days")
          .select("program_id, day_index, workout_templates ( id, title, type )")
          .in("program_id", ids)
          .order("day_index")
      : Promise.resolve({ data: [] }),
    supabase
      .from("program_enrollments")
      .select(
        "start_date, end_date, repeat, programs ( id, title, level, weeks )",
      )
      .eq("active", true),
  ]);
  const days = (dayRows ?? []) as unknown as DayRow[];

  // 프로그램별 일차 수·워크아웃 있는 날·유형 집합
  const stats = new Map<
    string,
    { dayCount: number; workoutDays: number; types: string[] }
  >();
  for (const d of days) {
    const s = stats.get(d.program_id) ?? {
      dayCount: 0,
      workoutDays: 0,
      types: [] as string[],
    };
    s.dayCount += 1;
    if (d.workout_templates.length) s.workoutDays += 1;
    for (const w of d.workout_templates)
      if (w.type && !s.types.includes(w.type)) s.types.push(w.type);
    stats.set(d.program_id, s);
  }

  const mine = programs.filter((p) => p.owner_id === user!.id);
  const community = programs.filter(
    (p) => p.owner_id !== user!.id && p.is_public,
  );

  // 작성자 이름·참여 인원은 직접 조회할 수 없다(profiles·enrollments 는 본인 행만).
  // 공개 프로그램에 한해 RPC 가 내려준다.
  const { data: statRows } = community.length
    ? await supabase.rpc("public_program_stats", {
        p_ids: community.map((p) => p.id),
      })
    : { data: [] };
  const byProgram = new Map(
    ((statRows ?? []) as {
      program_id: string;
      owner_name: string;
      enroll_count: number;
    }[]).map((r) => [r.program_id, r]),
  );

  // 진행 중 프로그램은 여러 개일 수 있다(096)
  const enrolls = (enrollRow ?? []) as unknown as ActiveEnroll[];
  const activeIds = new Set(enrolls.map((e) => e.programs?.id).filter(Boolean) as string[]);

  // 진행 중 카드 — 프로그램마다 오늘 일차와 첫 템플릿
  type Running = {
    id: string;
    title: string;
    level: string | null;
    weeks: number | null;
    startDate: string;
    endDate: string | null;
    dayIndex: number | null;
    weekNo: number | null;
    todayTemplate: { id: string; title: string } | null;
    workoutDays: number;
  };
  const runningList: Running[] = [];
  for (const enroll of enrolls) {
    if (!enroll.programs) continue;
    const pid = enroll.programs.id;
    const pdays = days.filter((d) => d.program_id === pid);
    const cycleLen = pdays.reduce((m, d) => Math.max(m, d.day_index), 0);
    const todayIso = todayISOIn(tz);
    const daysSince = Math.round(
      (Date.parse(todayIso) - Date.parse(enroll.start_date)) / 86400000,
    );
    const past =
      enroll.end_date != null && Date.parse(todayIso) > Date.parse(enroll.end_date);
    const raw = past
      ? null
      : programDayNumber(daysSince, cycleLen, enroll.repeat);
    const dayIndex = raw != null && raw <= cycleLen ? raw : null;
    const todayDay = dayIndex
      ? (pdays.find((d) => d.day_index === dayIndex) ?? null)
      : null;
    runningList.push({
      id: pid,
      title: enroll.programs.title,
      level: enroll.programs.level,
      weeks: enroll.programs.weeks,
      startDate: enroll.start_date,
      endDate: enroll.end_date,
      dayIndex,
      weekNo: dayIndex ? Math.floor((dayIndex - 1) / 7) + 1 : null,
      todayTemplate: todayDay?.workout_templates[0] ?? null,
      workoutDays: stats.get(pid)?.workoutDays ?? 0,
    });
  }
  // 오늘 할 것이 있는 프로그램을 위로
  runningList.sort((a, b) => Number(!!b.todayTemplate) - Number(!!a.todayTemplate));

  const todayByProgram = new Map(runningList.map((r) => [r.id, r.todayTemplate]));
  const card = (p: Program): ProgramCardData => {
    const s = stats.get(p.id);
    const extra = byProgram.get(p.id);
    return {
      id: p.id,
      title: p.title,
      description: p.description,
      level: p.level,
      weeks: p.weeks,
      isPublic: p.is_public,
      active: activeIds.has(p.id),
      workoutDays: s?.workoutDays ?? 0,
      types: s?.types ?? [],
      createdAt: p.created_at,
      ownerName: extra?.owner_name ?? null,
      enrollCount: extra?.enroll_count ?? null,
      todayTemplate: todayByProgram.get(p.id) ?? null,
    };
  };

  // 시안 training.tsx Programs 그대로: PageHead(프로그램 만들기) · Segments · .rx-card-grid.
  // 진행 중 프로그램의 "오늘 운동" 링크는 카드 안에 들어간다(§4-1: AI 생성 버튼도 시안에 없음).
  return (
    <>
      <PageHead
        title={t("programs.title")}
        description={t("programs.intro")}
        action={
          <div className="rx-actions">
            <AiProgramButton />
            <Go href="/programs/new" primary>
              <Plus size={16} />
              {t("programs.create")}
            </Go>
          </div>
        }
      />
      <ProgramFinder mine={mine.map(card)} community={community.map(card)} />
    </>
  );
}
