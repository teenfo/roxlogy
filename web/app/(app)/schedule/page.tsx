import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { formatDateShort } from "@/lib/format";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.schedule") };
}

type EnrollProgram = {
  start_date: string;
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
  const { t, tag } = await getT();

  const { data: enrollment } = await supabase
    .from("program_enrollments")
    .select(
      `start_date,
       programs ( id, title,
         program_days ( day_index, focus,
           workout_templates ( id, title, type ) ) )`,
    )
    .eq("active", true)
    .maybeSingle();

  const enroll = (enrollment ?? null) as unknown as EnrollProgram | null;

  if (!enroll?.programs) {
    return (
      <main>
        <h1 className="text-2xl font-bold">{t("schedule.title")}</h1>
        <p className="mt-6 rounded-md bg-surface px-4 py-10 text-center text-sm text-muted">
          {t("schedule.noProgram")}{" "}
          <Link href="/programs" className="text-accent hover:underline">
            {t("schedule.browsePrograms")}
          </Link>
        </p>
      </main>
    );
  }

  const dayMap = new Map(
    enroll.programs.program_days.map((d) => [d.day_index, d]),
  );
  const start = midnight(new Date(enroll.start_date + "T00:00:00"));
  const today = midnight(new Date());

  // 이번 주(월요일 시작) + weekOffset
  const base = midnight(new Date());
  base.setDate(base.getDate() - ((base.getDay() + 6) % 7) + weekOffset * 7);
  const week7 = Array.from({ length: 7 }, (_, i) => {
    const date = midnight(new Date(base));
    date.setDate(base.getDate() + i);
    const dayIndex =
      Math.floor((date.getTime() - start.getTime()) / 86400000) + 1;
    return {
      date,
      dayIndex,
      isToday: date.getTime() === today.getTime(),
      day: dayIndex >= 1 ? (dayMap.get(dayIndex) ?? null) : null,
    };
  });

  return (
    <main>
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">{t("schedule.title")}</h1>
        <Link
          href={`/programs/${enroll.programs.id}`}
          className="text-sm text-accent hover:underline"
        >
          {enroll.programs.title}
        </Link>
      </div>

      <nav className="mt-4 flex items-center justify-between text-sm">
        <Link
          href={`/schedule?week=${weekOffset - 1}`}
          className="text-accent hover:underline"
        >
          {t("schedule.prevWeek")}
        </Link>
        {weekOffset !== 0 && (
          <Link href="/schedule" className="text-xs text-muted hover:underline">
            {t("schedule.thisWeek")}
          </Link>
        )}
        <Link
          href={`/schedule?week=${weekOffset + 1}`}
          className="text-accent hover:underline"
        >
          {t("schedule.nextWeek")}
        </Link>
      </nav>

      <ul className="mt-6 flex flex-col gap-2">
        {week7.map((d) => (
          <li
            key={d.date.toISOString()}
            className={`rounded-md px-4 py-3 ${
              d.isToday ? "bg-accent/10 ring-1 ring-accent/40" : "bg-surface"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">
                {formatDateShort(d.date.toISOString(), tag)}
                {d.isToday && (
                  <span className="ml-2 text-xs text-accent">
                    {t("schedule.today")}
                  </span>
                )}
              </span>
              {d.day && (
                <span className="text-xs text-muted">
                  {t("programs.dayN", { n: d.dayIndex })}
                </span>
              )}
            </div>
            {d.day ? (
              <div className="mt-1.5">
                {d.day.focus && (
                  <p className="text-sm text-foreground/90">{d.day.focus}</p>
                )}
                {d.day.workout_templates.length > 0 && (
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {d.day.workout_templates.map((w) => (
                      <li
                        key={w.id}
                        className="rounded-full bg-background px-2.5 py-0.5 text-xs text-muted"
                      >
                        {w.title}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted">{t("schedule.rest")}</p>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
