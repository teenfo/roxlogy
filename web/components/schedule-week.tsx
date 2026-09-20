"use client";

import { useState } from "react";
import { Dumbbell } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { Chip, Empty, Go } from "@/components/rox/ui";

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
  /** 날짜 전체 문구 — .rx-section-label */
  label: string;
  /** 0=일, 6=토 */
  dow: number;
  isToday: boolean;
  plans: DayPlan[];
};

/**
 * 주간 훈련 — 시안 training.tsx Schedule 의 Panel 본문 그대로: .rx-week 7일 버튼 →
 * .rx-section-label → 선택한 날의 .rx-schedule-row / Empty(휴식일).
 * 날짜 계산은 서버에서 끝났고 여기서는 고른 날만 바뀐다.
 */
export function ScheduleWeek({ week, solo }: { week: WeekDay[]; solo: boolean }) {
  const { t } = useI18n();
  const todayIdx = Math.max(0, week.findIndex((d) => d.isToday));
  const [selected, setSelected] = useState(todayIdx);
  const day = week[selected] ?? week[0];
  const rows = day.plans.flatMap((pl) =>
    pl.workouts.map((w) => ({ pl, w })),
  );

  return (
    <>
      <div className="rx-week">
        {week.map((d, i) => (
          <button
            key={d.iso}
            type="button"
            aria-pressed={selected === i}
            className={selected === i ? "selected" : ""}
            onClick={() => setSelected(i)}
          >
            <small>{d.weekday}</small>
            <b>{d.dayOfMonth}</b>
            <i className={d.plans.some((pl) => pl.workouts.length) ? "has" : ""} />
          </button>
        ))}
      </div>
      <div className="rx-section-label">
        {day.label}
        {day.isToday ? ` · ${t("schedule.today")}` : ""}
      </div>
      {!rows.length ? (
        <Empty title={t("schedule.rest")} description={t("schedule.restDesc")} />
      ) : (
        rows.map(({ pl, w }) => (
          <div className="rx-schedule-row" key={w.id}>
            <span className="rx-workout-icon">
              <Dumbbell size={20} />
            </span>
            <div>
              <h3>{w.title}</h3>
              <p>
                {[
                  solo ? null : pl.progTitle,
                  t(`programs.type.${w.type}` as Parameters<typeof t>[0]),
                  t("programs.dayN", { n: pl.dayIndex }),
                  pl.focus,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            {day.isToday || pl.done ? (
              <Go href={pl.doneSessionId ? `/sessions/${pl.doneSessionId}` : `/workouts/${w.id}`}>
                {pl.done ? t("schedule.doneRecord") : t("schedule.viewWorkout")}
              </Go>
            ) : (
              <Chip>{t("schedule.planned")}</Chip>
            )}
          </div>
        ))
      )}
    </>
  );
}
