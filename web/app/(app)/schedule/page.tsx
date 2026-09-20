import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
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
import { ScheduleWeek, type WeekDay } from "@/components/schedule-week";
import { Button } from "@/components/ui/button";
import { Empty, Go, Hint, PageHead, Panel, ProgressBar } from "@/components/rox/ui";

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

/**
 * 주간 일정 — 시안 training.tsx 의 Schedule 그대로 (PORT_PLAN §3-c):
 * PageHead(프로그램 관리) · two-col[Panel "주간 훈련"(주 이동 · .rx-week · 선택한 날) |
 * Panel "이번 주 진행"(summary-time · ProgressBar) · Panel "내 레이스 일정"].
 * 레이스 계획 폼(RacePlanForm)은 시안에 없는 우리 기능 — Panel 안에 그대로(§4-1).
 */
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
  const [{ data: enrollment }, { data: planRows }] = await Promise.all([
    supabase
      .from("program_enrollments")
      .select(
        `start_date, repeat, end_date,
         programs ( id, title, weeks,
           program_days ( day_index, focus,
             workout_templates ( id, title, type ) ) )`,
      )
      .eq("active", true),
    // 내가 만든 계획 + 파트너로 초대받은 계획 (RPC 가 합쳐 준다)
    supabase.rpc("my_race_plans"),
  ]);

  const enrolls = ((enrollment ?? []) as unknown as EnrollProgram[]).filter(
    (e) => e.programs,
  );
  const plans = (planRows ?? []) as MyRacePlan[];
  const today0 = todayISOIn(tz);

  const racePanel = (
    <Panel
      title={t("schedule.myRaces")}
      action={<RacePlanForm myPlans={plans} part="trigger" today={today0} />}
    >
      <div style={{ padding: "0 24px 24px" }}>
        <RacePlanForm myPlans={plans} part="list" today={today0} />
      </div>
    </Panel>
  );

  const head = (
    <PageHead
      title={t("schedule.title")}
      description={t("schedule.intro")}
      action={
        <Go href="/programs">
          {t("schedule.changeProgram")} <ArrowRight size={16} />
        </Go>
      }
    />
  );

  if (enrolls.length === 0) {
    return (
      <>
        {head}
        <div className="rx-two-col">
          <Panel title={t("schedule.weekly")}>
            <Empty
              title={t("schedule.noProgram")}
              description={t("programs.intro")}
              action={
                <Go href="/programs" primary>
                  {t("schedule.browsePrograms")}
                </Go>
              }
            />
          </Panel>
          <div>{racePanel}</div>
        </div>
      </>
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
  const [{ data: doneRows }, { data: itemRows }] = allTemplateIds.length
    ? await Promise.all([
        supabase
          .from("sessions")
          .select("id, template_id")
          .eq("user_id", user!.id)
          .is("deleted_at", null)
          .in("template_id", allTemplateIds),
        supabase
          .from("workout_template_items")
          .select("id, template_id")
          .in("template_id", allTemplateIds),
      ])
    : [{ data: [] }, { data: [] }];
  const doneByTemplate = new Map<string, string>();
  for (const r of (doneRows ?? []) as { id: string; template_id: string | null }[])
    if (r.template_id) doneByTemplate.set(r.template_id, r.id);

  // WOD 체크리스트 완료 판정: 템플릿의 모든 아이템이 완료되면 WOD 완료로 본다
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
    const dayPlans = progs.flatMap((p) => {
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
    const withWork = dayPlans.filter((pl) => pl.day.workout_templates.length > 0);
    return {
      date,
      plans: dayPlans,
      withWork,
      isToday: date.getTime() === today.getTime(),
      // 그날 할 일이 여러 프로그램에 걸쳐 있으면 전부 끝내야 완료다
      done: withWork.length > 0 && withWork.every((pl) => pl.done),
    };
  });

  // 이번 주 달성률: 워크아웃이 있는 날 중 완료한 비율
  const scheduled = week7.filter((d) => d.withWork.length > 0);
  const doneCount = scheduled.filter((d) => d.done).length;
  const solo = progs.length === 1 ? progs[0] : null;
  const fmt = (d: Date, opt: Intl.DateTimeFormatOptions) =>
    d.toLocaleDateString(tag, { ...opt, timeZone: tz });
  const weekRange = `${fmt(base, { month: "numeric", day: "numeric" })} – ${fmt(week7[6].date, {
    month: "numeric",
    day: "numeric",
  })}`;
  const itemCount = (templateId: string) => itemsByTemplate.get(templateId)?.length ?? 0;

  // 표시용으로 납작하게 — 날짜 계산은 서버에서 끝내고 컴포넌트는 그리기만 한다
  const weekRows: WeekDay[] = week7.map((d) => ({
    iso: d.date.toISOString(),
    weekday: fmt(d.date, { weekday: "short" }),
    dayOfMonth: d.date.getDate(),
    label: fmt(d.date, { month: "long", day: "numeric", weekday: "long" }),
    dow: d.date.getDay(),
    isToday: d.isToday,
    plans: d.plans.map((pl) => ({
      progId: pl.progId,
      progTitle: pl.progTitle,
      dayIndex: pl.dayIndex,
      focus: pl.day.focus,
      workouts: pl.day.workout_templates.map((w) => ({
        id: w.id,
        title: w.title,
        type: w.type,
        items: itemCount(w.id),
      })),
      doneSessionId: pl.doneSessionId,
      done: pl.done,
    })),
  }));

  return (
    <>
      {head}
      <div className="rx-two-col">
        <Panel
          title={t("schedule.weekly")}
          action={
            <div className="rx-actions">
              <Button asChild variant="ghost" size="icon">
                <Link href={`/schedule?week=${weekOffset - 1}`} aria-label={t("schedule.prevWeek")}>
                  <ChevronLeft size={18} />
                </Link>
              </Button>
              <span>{weekRange}</span>
              <Button asChild variant="ghost" size="icon">
                <Link href={`/schedule?week=${weekOffset + 1}`} aria-label={t("schedule.nextWeek")}>
                  <ChevronRight size={18} />
                </Link>
              </Button>
            </div>
          }
        >
          <ScheduleWeek week={weekRows} solo={!!solo} />
          {weekOffset !== 0 && (
            <div className="rx-actions" style={{ padding: "0 24px 24px" }}>
              <Go href="/schedule">{t("schedule.goThisWeek")}</Go>
            </div>
          )}
        </Panel>
        <div>
          <Panel title={t("schedule.progress")}>
            <div className="rx-summary-time">
              {doneCount}
              <small> / {scheduled.length}</small>
            </div>
            <p>
              {scheduled.length > 0
                ? t("schedule.weeklyRate", { done: doneCount, total: scheduled.length })
                : t("schedule.outOfProgram")}
              {solo ? ` · ${solo.title}` : ` · ${t("schedule.nPrograms", { n: progs.length })}`}
            </p>
            <ProgressBar
              label={t("schedule.progress")}
              value={scheduled.length ? (doneCount / scheduled.length) * 100 : 0}
            />
            <Hint>{t("schedule.progressHint")}</Hint>
          </Panel>
          {racePanel}
        </div>
      </div>
    </>
  );
}
