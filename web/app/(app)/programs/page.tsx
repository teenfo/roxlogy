import Link from "next/link";
import { AiProgramButton } from "@/components/ai-program-button";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { programDayNumber, todayISOIn } from "@/lib/format";
import { dictLabel } from "@/lib/dict-label";
import { ProgramFinder, type ProgramCardData } from "@/components/program-finder";

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
  const { t, tag, tz } = await getT();
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
      .eq("active", true)
      .maybeSingle(),
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

  const enroll = enrollRow as unknown as ActiveEnroll | null;

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
      active: enroll?.programs?.id === p.id,
      workoutDays: s?.workoutDays ?? 0,
      types: s?.types ?? [],
      createdAt: p.created_at,
      ownerName: extra?.owner_name ?? null,
      enrollCount: extra?.enroll_count ?? null,
    };
  };

  // 진행 중 카드 — 오늘 일차와 첫 템플릿
  let running: {
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
  } | null = null;
  if (enroll?.programs) {
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
    running = {
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
    };
  }

  const dateLabel = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(tag, {
      month: "long",
      day: "numeric",
    });

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[30px] font-extrabold tracking-tight max-md:text-2xl">
            {t("programs.title")}
          </h1>
          <p className="mt-1 text-[15px] text-muted">{t("programs.desc")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 max-md:w-full">
          <AiProgramButton />
          <Link
            href="/programs/new"
            className="flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-extrabold text-background transition hover:brightness-110 max-md:flex-1 max-md:justify-center"
          >
            {t("programs.create")}
          </Link>
        </div>
      </div>

      {/* 진행 중 프로그램 */}
      {running ? (
        <section className="grid items-center gap-5 rounded-2xl border border-line-accent bg-highlight px-6 py-5 max-md:grid-cols-1 max-md:px-4 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="flex min-w-0 flex-col gap-3">
            <p className="flex flex-wrap items-center gap-x-2 text-xs font-extrabold tracking-[0.1em] text-accent">
              {t("programs.enrolled")}
              <span className="font-semibold tracking-normal text-[#8a7a2a]">
                {dateLabel(running.startDate)}
                {running.endDate ? ` – ${dateLabel(running.endDate)}` : ""}
              </span>
            </p>
            <Link
              href={`/programs/${running.id}`}
              className="text-[22px] font-extrabold tracking-tight hover:text-accent max-md:text-lg"
            >
              {running.title}
            </Link>
            <p className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[13px] text-foreground/80">
              {running.level && (
                <span className="rounded-md bg-accent/15 px-2 py-0.5 text-xs font-bold text-accent-dim">
                  {dictLabel(t, `predict.level.${running.level}`, running.level)}
                </span>
              )}
              {running.weeks && (
                <span>{t("programs.weeksN", { n: running.weeks })}</span>
              )}
              {running.dayIndex && (
                <span className="tabular">
                  {t("programs.weekDay", {
                    w: running.weekNo ?? 1,
                    d: running.dayIndex,
                  })}
                </span>
              )}
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2 max-md:items-stretch">
            {running.todayTemplate ? (
              <Link
                href={`/workouts/${running.todayTemplate.id}`}
                className="flex h-11 items-center justify-center rounded-lg bg-accent px-5 text-[15px] font-extrabold text-background transition hover:brightness-110"
              >
                ▶ {running.todayTemplate.title}
              </Link>
            ) : (
              <Link
                href="/schedule"
                className="flex h-11 items-center justify-center rounded-lg border border-line-accent px-5 text-[15px] font-bold text-accent transition hover:brightness-125"
              >
                {t("schedule.title")}
              </Link>
            )}
            <Link
              href="/schedule"
              className="text-xs font-semibold text-[#8a7a2a] hover:text-accent"
            >
              {t("schedule.title")} →
            </Link>
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-dashed border-line-strong bg-card px-6 py-8 text-center">
          <p className="text-sm text-muted [word-break:keep-all]">
            {t("programs.noneRunning")}
          </p>
        </section>
      )}

      {/* 내 프로그램 + 커뮤니티 — 필터·검색은 클라이언트에서 즉시 반영 */}
      <ProgramFinder mine={mine.map(card)} community={community.map(card)} />
    </main>
  );
}
