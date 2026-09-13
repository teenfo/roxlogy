"use client";

import Link from "next/link";
import { useI18n } from "@/components/i18n-provider";
import { wodTypeChip } from "@/lib/wod-type";

/** 하루에 걸린 한 프로그램의 계획 */
export type DayPlan = {
  progId: string;
  progTitle: string;
  dayIndex: number;
  focus: string | null;
  /** 그날 워크아웃 — 비어 있으면 휴식일 */
  workouts: { id: string; title: string; type: string; items: number }[];
  /** 이 계획에 태깅된 내 세션 (있으면 그 세션으로 간다) */
  doneSessionId: string | null;
  done: boolean;
};

export type WeekDay = {
  /** ISO 날짜 — 키와 링크에만 쓴다 */
  iso: string;
  weekday: string;
  dayOfMonth: number;
  /** 0=일, 6=토 — 주말 색 */
  dow: number;
  isToday: boolean;
  plans: DayPlan[];
};

const weekdayCls = (dow: number) =>
  dow === 0 ? "text-sunday" : dow === 6 ? "text-info" : "text-muted";

/**
 * 일정 주간 목록 — 날짜마다 진행 중인 프로그램별로 한 블록씩 쌓는다.
 * 프로그램이 하나뿐이면(solo) 이름표를 생략해 예전 화면과 같아 보인다.
 */
export function ScheduleWeek({ week, solo }: { week: WeekDay[]; solo: boolean }) {
  const { t } = useI18n();

  return (
    <ul className="flex flex-col gap-2">
      {week.map((d) => {
        const withWork = d.plans.filter((pl) => pl.workouts.length > 0);
        const rest = withWork.length === 0;
        const done = withWork.length > 0 && withWork.every((pl) => pl.done);
        // 그날 워크아웃이 딱 하나면 줄 전체를 링크로(기존 동작), 여럿이면 칩마다 링크
        const only =
          withWork.length === 1 && withWork[0].workouts.length === 1 ? withWork[0] : null;
        const onlyHref = only
          ? only.doneSessionId
            ? `/sessions/${only.doneSessionId}`
            : `/workouts/${only.workouts[0].id}`
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
              <p className={`text-xs font-bold ${weekdayCls(d.dow)}`}>{d.weekday}</p>
              <p
                className={`tabular text-2xl font-extrabold leading-tight ${
                  d.isToday ? "text-accent" : rest ? "text-muted" : ""
                }`}
              >
                {d.dayOfMonth}
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
                withWork.map((pl) => (
                  <div key={pl.progId} className="flex min-w-0 flex-col gap-1">
                    {/* 프로그램 이름표는 윗줄에 — 긴 제목과 한 줄에 두면 좁은 화면에서 줄바꿈이 지저분하다 */}
                    {!solo && (
                      <span className="block w-fit max-w-full truncate rounded-md bg-line px-1.5 py-0.5 text-[11px] font-bold text-muted">
                        {pl.progTitle}
                      </span>
                    )}
                    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span
                        className={`min-w-0 truncate ${d.isToday ? "text-[19px]" : "text-base"} font-bold`}
                      >
                        {pl.focus ?? pl.workouts[0].title}
                      </span>
                      <span className="shrink-0 text-xs font-semibold text-muted">
                        {t("programs.dayN", { n: pl.dayIndex })}
                      </span>
                      {pl.done && (
                        <span className="shrink-0 text-xs font-bold text-success">✓</span>
                      )}
                    </p>
                    <span className="flex flex-wrap gap-1.5">
                      {pl.workouts.map((w) => {
                        const chip = (
                          <>
                            <span className="truncate">{w.title}</span>
                            {w.items > 0 && <span className="tabular opacity-70">{w.items}</span>}
                          </>
                        );
                        const cls = `flex h-[26px] max-w-full items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold ${wodTypeChip(w.type)}`;
                        // 줄 전체가 이미 링크면 칩은 링크로 두지 않는다 — a 안의 a 는 잘못된 HTML 이라
                        // 하이드레이션이 깨진다(React #418).
                        return onlyHref ? (
                          <span key={w.id} className={cls}>
                            {chip}
                          </span>
                        ) : (
                          <Link key={w.id} href={`/workouts/${w.id}`} className={cls} prefetch={false}>
                            {chip}
                          </Link>
                        );
                      })}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* 우측 */}
            <div className="flex shrink-0 items-center gap-2.5 max-md:col-span-2 max-md:justify-end">
              {done && (
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

        return <li key={d.iso}>{onlyHref ? (
          <Link href={onlyHref} prefetch={false}>
            {body}
          </Link>
        ) : (
          body
        )}</li>;
      })}
    </ul>
  );
}
