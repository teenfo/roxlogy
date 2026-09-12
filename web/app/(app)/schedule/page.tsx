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

  // 진행 중 프로그램은 여러 개일 수 있다(096) — maybeSingle 은 2건부터 에러를 낸다
  const { data: enrollment } = await supabase
    .from("program_enrollments")
    .select(
      `start_date, repeat, end_date,
       programs ( id, title, weeks,
         program_days ( day_index, focus,
           workout_templates ( id, title, type ) ) )`,
    )
    .eq("active", true);

  const enrolls = ((enrollment ?? []) as unknown as EnrollProgram[]).filter(
    (e) => e.programs,
  );

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

  if (enrolls.length === 0) {
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

  // 프로그램마다 일차 계산에 필요한 값을 미리 뽑는다
  const progs = enrolls.map((e) => {
    const pr = e.programs!;
    return {
      id: pr.id,
      title: pr.title,
      weeks: pr.weeks,
      dayMap: new Map(pr.program_days.map((d) => [d.day_index, d])),
      cycleLen: pr.program_days.reduce((m, d) => Math.max(m, d.day_index), 0),
      start: midnight(new Date(e.start_date + "T00:00:00")),
      repeat: e.repeat,
      endAt: e.end_date ? midnight(new Date(e.end_date + "T00:00:00")) : null,
    };
  });

  // 완료 판정: 진행 중인 모든 프로그램의 템플릿에 태깅된 내 세션
  const allTemplateIds = enrolls.flatMap((e) =>
    e.programs!.program_days.flatMap((d) => d.workout_templates.map((w) => w.id)),
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

  // 서버는 UTC — 사용자 시간대(폴백 KST) 기준 오늘
  const today = midnight(todayMidnightIn(tz));

  // 이번 주(월요일 시작) + weekOffset
  const base = midnight(new Date());
  base.setDate(base.getDate() - ((base.getDay() + 6) % 7) + weekOffset * 7);
  const week7 = Array.from({ length: 7 }, (_, i) => {
    const date = midnight(new Date(base));
    date.setDate(base.getDate() + i);
    // 날짜 하나에 진행 중인 프로그램마다 한 블록씩 쌓인다
    const plans = progs.flatMap((p) => {
      const daysSince = Math.floor((date.getTime() - p.start.getTime()) / 86400000);
      // 종료 판정: 등록 종료일 경과 또는 일차 > 길이 = 끝 (반복은 종료일까지 순환)
      const pastEnd = p.endAt !== null && date.getTime() > p.endAt.getTime();
      const raw = pastEnd
        ? -1
        : (programDayNumber(daysSince, p.cycleLen, p.repeat) ?? -1);
      const dayIndex = raw > p.cycleLen ? -1 : raw;
      if (dayIndex < 1) return [];
      const day = p.dayMap.get(dayIndex) ?? null;
      if (!day) return [];
      const doneSessionId =
        day.workout_templates.map((w) => doneByTemplate.get(w.id)).find(Boolean) ?? null;
      // WOD 완료(체크리스트) 또는 태깅된 세션이 있으면 완료로 본다
      const wodDone = day.workout_templates.some((w) => wodDoneTemplates.has(w.id));
      return [
        {
          progId: p.id,
          progTitle: p.title,
          dayIndex,
          day,
          doneSessionId,
          done: !!doneSessionId || wodDone,
        },
      ];
    });
    const withWork = plans.filter((pl) => pl.day.workout_templates.length > 0);
    return {
      date,
      plans,
      withWork,
      isToday: date.getTime() === today.getTime(),
      // 그날 할 일이 여러 프로그램에 걸쳐 있으면 전부 끝내야 완료다
      done: withWork.length > 0 && withWork.every((pl) => pl.done),
    };
  });

  // 이번 주 달성률: 워크아웃이 있는 날 중 완료한 비율
  const scheduled = week7.filter((d) => d.withWork.length > 0);
  const doneCount = scheduled.filter((d) => d.done).length;

  // 헤더 표시용 — 프로그램이 하나면 그 프로그램을, 여럿이면 개수를 보여 준다
  const todayCell = week7.find((d) => d.isToday) ?? null;
  const solo = progs.length === 1 ? progs[0] : null;
  const soloToday = solo
    ? (todayCell?.plans.find((pl) => pl.progId === solo.id) ?? null)
    : null;
  const weekNo = soloToday ? Math.floor((soloToday.dayIndex - 1) / 7) + 1 : null;
  const todayFirst = todayCell?.withWork[0]?.day.workout_templates[0] ?? null;
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
            <span className="rounded-md border border-line-accent bg-highlight px-2 py-[3px] text-xs font-extrabold tracking-[0.08em] text-accent">
              PROGRAM
            </span>
            {solo ? (
              <>
                <Link
                  href={`/programs/${solo.id}`}
                  className="font-semibold text-accent hover:underline"
                >
                  {solo.title}
                </Link>
                {soloToday && (
                  <span className="tabular">
                    ·{" "}
                    {solo.weeks
                      ? t("schedule.weekOfN", {
                          w: weekNo ?? 1,
                          total: solo.weeks,
                          d: soloToday.dayIndex,
                        })
                      : t("programs.weekDay", {
                          w: weekNo ?? 1,
                          d: soloToday.dayIndex,
                        })}
                  </span>
                )}
              </>
            ) : (
              <Link href="/programs" className="font-semibold text-accent hover:underline">
                {t("schedule.nPrograms", { n: progs.length })}
              </Link>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2 max-md:w-full">
          <Link
            href="/programs"
            className="flex h-10 items-center rounded-lg border border-line-strong bg-control px-4 text-sm font-semibold transition-colors hover:border-line-strong max-md:flex-1 max-md:justify-center"
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
                      : d.withWork.length
                        ? "bg-[#2a2a2a]"
                        : "bg-line-soft"
                }`}
              />
            ))}
          </div>
        )}
      </div>

      {/* 날짜 행 — 진행 중인 프로그램마다 한 블록 */}
      <ul className="flex flex-col gap-2">
        {week7.map((d) => {
          const rest = d.withWork.length === 0;
          // 그날 워크아웃이 딱 하나면 줄 전체를 링크로(기존 동작), 여럿이면 칩마다 링크
          const only =
            d.withWork.length === 1 && d.withWork[0].day.workout_templates.length === 1
              ? d.withWork[0]
              : null;
          const onlyHref = only
            ? only.doneSessionId
              ? `/sessions/${only.doneSessionId}`
              : `/workouts/${only.day.workout_templates[0].id}`
            : null;
          const body = (
            <div
              className={`grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-4 rounded-[14px] border transition-colors max-md:grid-cols-[52px_minmax(0,1fr)] max-md:gap-3 ${
                d.isToday
                  ? "border-accent bg-highlight px-5 py-[18px] max-md:px-4"
                  : rest
                    ? "border-line-soft px-5 py-3.5 opacity-55 max-md:px-4"
                    : "border-line bg-card px-5 py-3.5 hover:border-line-strong max-md:px-4"
              }`}
            >
              {/* 날짜 블록 */}
              <div className="border-r border-line-mid pr-3 text-center">
                <p className={`text-xs font-bold ${weekdayCls(d.date)}`}>
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
              <div className="flex min-w-0 flex-col gap-2.5">
                {rest ? (
                  <p className="truncate text-[15px] font-medium text-muted">
                    {t("schedule.rest")}
                  </p>
                ) : (
                  d.withWork.map((pl) => (
                    <div key={pl.progId} className="flex min-w-0 flex-col gap-1.5">
                      <p className="flex flex-wrap items-center gap-2">
                        {!solo && (
                          <span className="shrink-0 rounded-md bg-line px-1.5 py-0.5 text-[11px] font-bold text-muted">
                            {pl.progTitle}
                          </span>
                        )}
                        <span
                          className={`truncate ${d.isToday ? "text-[19px]" : "text-base"} font-bold`}
                        >
                          {pl.day.focus ?? pl.day.workout_templates[0].title}
                        </span>
                        <span className="shrink-0 text-xs font-semibold text-muted">
                          {t("programs.dayN", { n: pl.dayIndex })}
                        </span>
                        {pl.done && (
                          <span className="shrink-0 text-xs font-bold text-success">✓</span>
                        )}
                      </p>
                      <span className="flex flex-wrap gap-1.5">
                        {pl.day.workout_templates.map((w) => (
                          <Link
                            key={w.id}
                            href={`/workouts/${w.id}`}
                            className={`flex h-[26px] items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold ${wodTypeChip(w.type)}`}
                          >
                            {w.title}
                            {itemCount(w.id) > 0 && (
                              <span className="tabular opacity-70">{itemCount(w.id)}</span>
                            )}
                          </Link>
                        ))}
                      </span>
                    </div>
                  ))
                )}
              </div>

              {/* 우측 */}
              <div className="flex shrink-0 items-center gap-2.5 max-md:col-span-2 max-md:justify-end">
                {d.done && (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-success-bg text-sm font-extrabold text-success">
                    ✓
                  </span>
                )}
                {d.isToday && !rest && (
                  <span className="flex h-9 items-center rounded-lg bg-accent px-3.5 text-[13px] font-extrabold text-background">
                    {t("schedule.startShort")} →
                  </span>
                )}
              </div>
            </div>
          );
          return (
            <li key={d.date.toISOString()}>
              {onlyHref ? <Link href={onlyHref}>{body}</Link> : body}
            </li>
          );
        })}
      </ul>

      {racePlanSection}
    </main>
  );
}
