import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import {
  RacePlanForm,
  type MyRacePlan,
} from "@/components/crew-schedule-forms";
import {
  programDayNumber,
  todayISOIn,
  todayMidnightIn,
} from "@/lib/format";
import { wodTypeChip } from "@/lib/wod-type";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.schedule") };
}

type EnrollProgram = {
  start_date: string;
  repeat: boolean;
  end_date: string | null;
  programs: {
    id: string;
    title: string;
    weeks: number | null;
    program_days: {
      day_index: number;
      focus: string | null;
      workout_templates: { id: string; title: string; type: string }[];
    }[];
  } | null;
};

/** 로컬 자정 기준 날짜 */
function midnight(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;
  const weekOffset = Number(week) || 0;
  const supabase = await createClient();
  const { t, tag, tz } = await getT();
  const user = await getCachedUser();

  const { data: enrollment } = await supabase
    .from("program_enrollments")
    .select(
      `start_date, repeat, end_date,
       programs ( id, title, weeks,
         program_days ( day_index, focus,
           workout_templates ( id, title, type ) ) )`,
    )
    .eq("active", true)
    .maybeSingle();

  const enroll = (enrollment ?? null) as unknown as EnrollProgram | null;

  // 내 대회 일정 — 프로그램 등록 여부와 무관하다. 아래 조기 return 분기에도
  // 같이 렌더해야 프로그램 없는 사용자가 막다른 길에 빠지지 않는다.
  // 내가 만든 계획 + 파트너로 초대받은 계획 (RPC 가 합쳐 준다)
  const { data: planRows } = await supabase.rpc("my_race_plans");
  const plans = (planRows ?? []) as MyRacePlan[];
  const racePlanSection = (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[15px] font-extrabold">{t("schedule.myRaces")}</h2>
        <span className="ml-auto">
          <RacePlanForm
            myPlans={plans}
            part="trigger"
            today={todayISOIn(tz)}
          />
        </span>
      </div>
      <RacePlanForm myPlans={plans} part="list" today={todayISOIn(tz)} />
    </section>
  );

  if (!enroll?.programs) {
    return (
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-5">
        <h1 className="text-[30px] font-extrabold tracking-tight max-md:text-2xl">
          {t("schedule.title")}
        </h1>
        <div className="rounded-[14px] border border-line bg-card px-6 py-10 text-center">
          <p className="text-sm text-muted [word-break:keep-all]">
            {t("schedule.noProgram")}
          </p>
          <Link
            href="/programs"
            className="mt-4 inline-flex h-10 items-center rounded-lg bg-accent px-5 text-sm font-extrabold text-background transition hover:brightness-110"
          >
            {t("schedule.browsePrograms")}
          </Link>
        </div>
        {racePlanSection}
      </main>
    );
  }

  const dayMap = new Map(
    enroll.programs.program_days.map((d) => [d.day_index, d]),
  );

  // 완료 판정: 이 프로그램의 워크아웃 템플릿에 태깅된 내 세션
  const allTemplateIds = enroll.programs.program_days.flatMap((d) =>
    d.workout_templates.map((w) => w.id),
  );
  const { data: doneRows } = allTemplateIds.length
    ? await supabase
        .from("sessions")
        .select("id, template_id")
        .eq("user_id", user!.id)
        .is("deleted_at", null)
        .in("template_id", allTemplateIds)
    : { data: [] };
  const doneByTemplate = new Map<string, string>();
  for (const r of (doneRows ?? []) as { id: string; template_id: string | null }[])
    if (r.template_id) doneByTemplate.set(r.template_id, r.id);

  // WOD 체크리스트 완료 판정: 템플릿의 모든 아이템이 완료되면 WOD 완료로 본다
  const { data: itemRows } = allTemplateIds.length
    ? await supabase
        .from("workout_template_items")
        .select("id, template_id")
        .in("template_id", allTemplateIds)
    : { data: [] };
  const itemsByTemplate = new Map<string, string[]>();
  for (const r of (itemRows ?? []) as { id: string; template_id: string }[]) {
    const arr = itemsByTemplate.get(r.template_id) ?? [];
    arr.push(r.id);
    itemsByTemplate.set(r.template_id, arr);
  }
  const allItemIds = (itemRows ?? []).map((r) => (r as { id: string }).id);
  const { data: compRows } = allItemIds.length
    ? await supabase
        .from("workout_item_completions")
        .select("item_id")
        .in("item_id", allItemIds)
    : { data: [] };
  const completedItems = new Set(
    (compRows ?? []).map((r) => (r as { item_id: string }).item_id),
  );
  const wodDoneTemplates = new Set<string>();
  for (const [tid, ids] of itemsByTemplate)
    if (ids.length > 0 && ids.every((i) => completedItems.has(i)))
      wodDoneTemplates.add(tid);

  const start = midnight(new Date(enroll.start_date + "T00:00:00"));
  // 서버는 UTC — 사용자 시간대(폴백 KST) 기준 오늘
  const today = midnight(todayMidnightIn(tz));
  const cycleLen = enroll.programs.program_days.reduce(
    (m, d) => Math.max(m, d.day_index),
    0,
  );
  const repeat = enroll.repeat;
  const endAt = enroll.end_date
    ? midnight(new Date(enroll.end_date + "T00:00:00"))
    : null;

  // 이번 주(월요일 시작) + weekOffset
  const base = midnight(new Date());
  base.setDate(base.getDate() - ((base.getDay() + 6) % 7) + weekOffset * 7);
  const week7 = Array.from({ length: 7 }, (_, i) => {
    const date = midnight(new Date(base));
    date.setDate(base.getDate() + i);
    const daysSince = Math.floor((date.getTime() - start.getTime()) / 86400000);
    // 종료 판정: 등록 종료일 경과 또는 일차 > 길이 = 끝 (반복은 종료일까지 순환)
    const pastEnd = endAt !== null && date.getTime() > endAt.getTime();
    const raw = pastEnd ? -1 : (programDayNumber(daysSince, cycleLen, repeat) ?? -1);
    const dayIndex = raw > cycleLen ? -1 : raw;
    const day = dayIndex >= 1 ? (dayMap.get(dayIndex) ?? null) : null;
    const doneSessionId = day
      ? (day.workout_templates
          .map((w) => doneByTemplate.get(w.id))
          .find(Boolean) ?? null)
      : null;
    // WOD 완료(체크리스트) 또는 태깅된 세션이 있으면 완료로 본다
    const wodDone = day
      ? day.workout_templates.some((w) => wodDoneTemplates.has(w.id))
      : false;
    return {
      date,
      dayIndex,
      isToday: date.getTime() === today.getTime(),
      day,
      doneSessionId,
      done: !!doneSessionId || wodDone,
    };
  });

  // 이번 주 달성률: 워크아웃이 있는 날 중 완료한 비율
  const scheduled = week7.filter((d) => d.day?.workout_templates.length);
  const doneCount = scheduled.filter((d) => d.done).length;

  // 헤더 표시용 파생값
  const todayCell = week7.find((d) => d.isToday) ?? null;
  const todayFirst = todayCell?.day?.workout_templates[0] ?? null;
  const weekNo = todayCell?.dayIndex
    ? Math.floor((todayCell.dayIndex - 1) / 7) + 1
    : null;
  const weekRange = `${base.toLocaleDateString(tag, {
    month: "long",
    day: "numeric",
    timeZone: tz,
  })} – ${week7[6].date.toLocaleDateString(tag, {
    month: "long",
    day: "numeric",
    timeZone: tz,
  })}`;
  const itemCount = (templateId: string) =>
    itemsByTemplate.get(templateId)?.length ?? 0;
  const weekdayCls = (d: Date) =>
    d.getDay() === 0 ? "text-sunday" : d.getDay() === 6 ? "text-info" : "text-muted";

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      {/* 헤더 — 프로그램과 현재 위치를 한 줄로 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[30px] font-extrabold tracking-tight max-md:text-2xl">
            {t("schedule.title")}
          </h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[15px] text-muted">
            <span className="rounded-md border border-line-accent bg-highlight px-2 py-[3px] text-[11px] font-extrabold tracking-[0.08em] text-accent">
              PROGRAM
            </span>
            <Link
              href={`/programs/${enroll.programs.id}`}
              className="font-semibold text-accent hover:underline"
            >
              {enroll.programs.title}
            </Link>
            {todayCell?.dayIndex && todayCell.dayIndex > 0 && (
              <span className="tabular">
                ·{" "}
                {enroll.programs.weeks
                  ? t("schedule.weekOfN", {
                      w: weekNo ?? 1,
                      total: enroll.programs.weeks,
                      d: todayCell.dayIndex,
                    })
                  : t("programs.weekDay", {
                      w: weekNo ?? 1,
                      d: todayCell.dayIndex,
                    })}
              </span>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2 max-md:w-full">
          <Link
            href="/programs"
            className="flex h-10 items-center rounded-lg border border-line-strong bg-control px-4 text-sm font-semibold transition-colors hover:border-[#555] max-md:flex-1 max-md:justify-center"
          >
            {t("schedule.changeProgram")}
          </Link>
          {todayFirst && (
            <Link
              href={`/workouts/${todayFirst.id}`}
              className="flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-extrabold text-background transition hover:brightness-110 max-md:flex-1 max-md:justify-center"
            >
              ▶ {t("schedule.startToday")}
            </Link>
          )}
        </div>
      </div>

      {/* 주 네비 */}
      <div className="flex flex-col gap-3 rounded-[14px] border border-line bg-card px-[18px] py-3.5 max-md:px-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center rounded-[10px] border border-line-mid bg-page p-1">
            <Link
              href={`/schedule?week=${weekOffset - 1}`}
              aria-label={t("schedule.prevWeek")}
              className="flex h-[34px] w-[34px] items-center justify-center rounded-lg text-accent hover:bg-card-hover"
            >
              ‹
            </Link>
            <span className="tabular min-w-[150px] px-2 text-center text-[15px] font-extrabold max-md:min-w-0">
              {weekRange}
            </span>
            <Link
              href={`/schedule?week=${weekOffset + 1}`}
              aria-label={t("schedule.nextWeek")}
              className="flex h-[34px] w-[34px] items-center justify-center rounded-lg text-accent hover:bg-card-hover"
            >
              ›
            </Link>
          </div>
          {weekOffset !== 0 && (
            <Link
              href="/schedule"
              className="text-[13px] font-semibold text-accent hover:underline"
            >
              {t("schedule.goThisWeek")}
            </Link>
          )}
          <span className="ml-auto text-[13px] text-muted max-md:ml-0">
            {scheduled.length > 0
              ? t("schedule.weeklyRate", {
                  done: doneCount,
                  total: scheduled.length,
                })
              : t("schedule.outOfProgram")}
          </span>
        </div>

        {scheduled.length > 0 && (
          <div className="grid grid-cols-7 gap-1">
            {week7.map((d) => (
              <span
                key={d.date.toISOString()}
                className={`h-1.5 rounded-[3px] ${
                  d.done
                    ? "bg-success"
                    : d.isToday
                      ? "bg-accent"
                      : d.day?.workout_templates.length
                        ? "bg-[#2a2a2a]"
                        : "bg-line-soft"
                }`}
              />
            ))}
          </div>
        )}
      </div>

      {/* 날짜 행 */}
      <ul className="flex flex-col gap-2">
        {week7.map((d) => {
          const templates = d.day?.workout_templates ?? [];
          const rest = templates.length === 0;
          const href = rest ? null : `/workouts/${templates[0].id}`;
          const body = (
            <div
              className={`grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-4 rounded-[14px] border transition-colors max-md:grid-cols-[52px_minmax(0,1fr)] max-md:gap-3 ${
                d.isToday
                  ? "border-accent bg-highlight px-5 py-[18px] max-md:px-4"
                  : rest
                    ? "border-line-soft px-5 py-3.5 opacity-55 max-md:px-4"
                    : "border-line bg-card px-5 py-3.5 hover:border-[#555] max-md:px-4"
              }`}
            >
              {/* 날짜 블록 */}
              <div className="border-r border-line-mid pr-3 text-center">
                <p className={`text-[11px] font-bold ${weekdayCls(d.date)}`}>
                  {d.date.toLocaleDateString(tag, {
                    weekday: "short",
                    timeZone: tz,
                  })}
                </p>
                <p
                  className={`tabular text-2xl font-extrabold leading-tight ${
                    d.isToday ? "text-accent" : rest ? "text-muted" : ""
                  }`}
                >
                  {d.date.getDate()}
                </p>
                {d.isToday && (
                  <span className="mt-0.5 inline-block rounded-full bg-accent px-1.5 text-[10px] font-extrabold text-background">
                    {t("schedule.today")}
                  </span>
                )}
              </div>

              {/* 본문 */}
              <div className="flex min-w-0 flex-col gap-1.5">
                <p className="flex flex-wrap items-center gap-2">
                  <span
                    className={`truncate ${
                      rest
                        ? "text-[15px] font-medium text-muted"
                        : `${d.isToday ? "text-[19px]" : "text-base"} font-bold`
                    }`}
                  >
                    {rest
                      ? t("schedule.rest")
                      : (d.day?.focus ?? templates[0].title)}
                  </span>
                  {d.dayIndex > 0 && (
                    <span className="shrink-0 text-[11px] font-semibold text-muted">
                      {t("programs.dayN", { n: d.dayIndex })}
                    </span>
                  )}
                </p>
                {templates.length > 0 && (
                  <span className="flex flex-wrap gap-1.5">
                    {templates.map((w) => (
                      <span
                        key={w.id}
                        className={`flex h-[26px] items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold ${wodTypeChip(w.type)}`}
                      >
                        {w.title}
                        {itemCount(w.id) > 0 && (
                          <span className="tabular opacity-70">
                            {itemCount(w.id)}
                          </span>
                        )}
                      </span>
                    ))}
                  </span>
                )}
              </div>

              {/* 우측 */}
              <div className="flex shrink-0 items-center gap-2.5 max-md:col-span-2 max-md:justify-end">
                {d.done && (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-success-bg text-sm font-extrabold text-success">
                    ✓
                  </span>
                )}
                {d.isToday && !rest ? (
                  <span className="flex h-9 items-center rounded-lg bg-accent px-3.5 text-[13px] font-extrabold text-background">
                    {t("schedule.startShort")} →
                  </span>
                ) : (
                  !rest && (
                    <span aria-hidden className="text-muted/60">
                      ›
                    </span>
                  )
                )}
              </div>
            </div>
          );
          return (
            <li key={d.date.toISOString()}>
              {href ? (
                <Link href={d.doneSessionId ? `/sessions/${d.doneSessionId}` : href}>
                  {body}
                </Link>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>

      {racePlanSection}
    </main>
  );
}
