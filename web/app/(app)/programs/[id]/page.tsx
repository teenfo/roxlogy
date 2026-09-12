import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { formatDateShort, programDayDate } from "@/lib/format";
import { targetParts, type WorkoutTarget } from "@/lib/target";
import { wodTypeDot } from "@/lib/wod-type";
import { ProgramBuilder } from "@/components/program-builder";
import { ProgramBasicsEditor } from "@/components/program-basics-editor";
import { ProgramCalendarSubscribe } from "@/components/program-calendar-subscribe";
import { ProgramEnrollButton } from "@/components/program-enroll-button";
import { CloneProgramButton } from "@/components/clone-program-button";
import { DeleteButton } from "@/components/delete-button";
import type { DictKey } from "@/lib/i18n/dictionaries/en";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("programs")
    .select("title")
    .eq("id", id)
    .maybeSingle();
  return { title: data ? `${data.title} — Roxlogy` : "Roxlogy" };
}

type Day = {
  id: string;
  day_index: number;
  focus: string | null;
  notes: string | null;
  workout_templates: {
    id: string;
    title: string;
    type: string;
    workout_template_items: {
      id: string;
      seq: number;
      exercise_id: string | null;
      target: WorkoutTarget | null;
      exercises: { name_ko: string; name_en: string } | null;
      pending_exercise: string | null;
      exercise_request_id: string | null;
    }[];
  }[];
};

export default async function ProgramDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const { id } = await params;
  const { preview } = await searchParams;
  const supabase = await createClient();
  const { t, tag, locale, tz } = await getT();
  const user = await getCachedUser();

  // RLS: 공용 또는 본인 소유만 조회됨. 트리 전체를 한 번에.
  const { data: program } = await supabase
    .from("programs")
    .select(
      `id, owner_id, title, description, weeks, level, is_public, calendar_token, week_pattern,
       program_days (
         id, day_index, focus, notes,
         workout_templates (
           id, title, type,
           workout_template_items (
             id, seq, exercise_id, target, pending_exercise, exercise_request_id,
             exercises ( name_ko, name_en )
           )
         )
       )`,
    )
    .eq("id", id)
    .maybeSingle();
  if (!program) notFound();

  const isOwner = program.owner_id === user!.id;
  // 소유자도 "남에게 어떻게 보이는지"를 볼 수 있어야 한다
  const readOnly = !isOwner || preview === "1";

  // 내 활성 등록 — 프로그램은 템플릿이고 날짜는 등록에 속한다 (own RLS)
  const { data: myEnroll } = await supabase
    .from("program_enrollments")
    .select("start_date, repeat, end_date")
    .eq("program_id", program.id)
    .eq("active", true)
    .maybeSingle();
  const isEnrolled = !!myEnroll;
  const myStart: string | null = myEnroll?.start_date ?? null;
  const myRepeat: boolean = myEnroll?.repeat === true;

  // 소유자면 편집용 운동 목록도 함께 전달
  const { data: exercises } =
    isOwner && !readOnly
      ? await supabase
          .from("exercises")
          .select("id, name_ko, name_en, station_type, category")
          .order(locale === "ko" ? "name_ko" : "name_en")
      : { data: null };

  const days = ((program.program_days ?? []) as unknown as Day[])
    .slice()
    .sort((a, b) => a.day_index - b.day_index);
  const totalDays = days.reduce((m, d) => Math.max(m, d.day_index), 0);
  const workoutCount = days.reduce((a, d) => a + d.workout_templates.length, 0);
  const itemCount = days.reduce(
    (a, d) =>
      a + d.workout_templates.reduce((b, w) => b + w.workout_template_items.length, 0),
    0,
  );
  const emptyWorkouts = days.reduce(
    (a, d) =>
      a + d.workout_templates.filter((w) => !w.workout_template_items.length).length,
    0,
  );
  const weekPattern = (program.week_pattern as number[] | null) ?? null;
  const perWeek = weekPattern?.length ?? null;

  // 종료: 반복이면 등록의 종료일(없으면 무기한), 비반복이면 시작 + 일차 수 − 1
  const myEnd = myRepeat
    ? (myEnroll?.end_date ?? null)
    : myStart && totalDays > 0
      ? (() => {
          const d = new Date(`${myStart}T00:00:00`);
          d.setDate(d.getDate() + totalDays - 1);
          d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
          return d.toISOString().slice(0, 10);
        })()
      : null;
  const exName = (ex: { name_ko: string; name_en: string } | null) =>
    ex ? (locale === "ko" ? ex.name_ko : ex.name_en) : "—";

  return (
    <main className="max-w-4xl">
      <div className="flex items-center justify-between">
        <Link href="/programs" className="text-[13px] text-muted hover:text-foreground">
          {t("programs.back")}
        </Link>
        {isOwner && preview === "1" && (
          <Link
            href={`/programs/${program.id}`}
            className="text-[13px] font-semibold text-accent hover:underline"
          >
            {t("programs.backToBuilder")}
          </Link>
        )}
      </div>

      {/* 히어로 */}
      <section className="mt-3 grid gap-5 rounded-2xl border border-line-mid bg-card px-6 py-5 md:grid-cols-[1fr_auto] max-md:px-4">
        <div className="flex min-w-0 flex-col gap-2">
          <p className="flex flex-wrap items-center gap-2 text-xs">
            {program.level && (
              <span className="rounded bg-line px-1.5 py-0.5 font-bold text-foreground/80">
                {t(`predict.level.${program.level}` as DictKey)}
              </span>
            )}
            <span className="text-muted">
              {program.weeks ? t("programs.weeksN", { n: program.weeks }) : ""}
              {perWeek ? ` · ${t("programs.perWeek", { n: perWeek })}` : ""}
              {` · ${program.is_public ? t("programs.public") : t("programs.private")}`}
            </span>
          </p>
          <h1 className="text-[26px] font-extrabold leading-tight">{program.title}</h1>
          <p className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[13px] text-muted">
            <span>
              {t("programs.builderStats", {
                d: totalDays,
                w: workoutCount,
                m: itemCount,
              })}
            </span>
            {emptyWorkouts > 0 ? (
              <span className="text-accent-dim">
                · {t("programs.emptyWods", { n: emptyWorkouts })}
              </span>
            ) : workoutCount > 0 ? (
              <span className="text-success">· {t("programs.allWodsSet")}</span>
            ) : null}
          </p>
          {isOwner && (
            <ProgramBasicsEditor
              programId={program.id}
              title={program.title}
              description={program.description}
              weeks={program.weeks}
              level={program.level}
              isPublic={program.is_public}
            />
          )}
        </div>

        <div className="flex flex-col items-end gap-2 max-md:items-stretch">
          <ProgramEnrollButton
            programId={program.id}
            initialActive={isEnrolled}
            totalDays={totalDays}
          />
          <div className="flex flex-wrap items-center gap-3 text-xs text-[#777] max-md:justify-between">
            {!isOwner && (
              <CloneProgramButton programId={program.id} title={program.title} />
            )}
            {isOwner && (
              <DeleteButton kind="program" id={program.id} redirectTo="/programs" />
            )}
          </div>
        </div>
      </section>

      {program.description && (
        <p className="mt-3 whitespace-pre-wrap text-sm text-muted">
          {program.description}
        </p>
      )}

      {/* 내 일정 — 날짜는 프로그램(템플릿)이 아니라 내 등록에 속한다 */}
      {myStart && (
        <>
          <p className="mt-3 flex flex-wrap items-center gap-3 text-[13px] font-medium text-info">
            <span>
              {t("programs.mySchedule")}: {formatDateShort(myStart, tag, tz)}
              {myEnd ? ` – ${formatDateShort(myEnd, tag, tz)}` : ""}
              {myRepeat ? " 🔁" : ""}
            </span>
            <a
              href={`/programs/${program.id}/calendar.ics`}
              className="rounded-md bg-control px-2.5 py-1 text-xs font-semibold text-foreground hover:text-accent"
            >
              📅 {t("programs.icsDownload")}
            </a>
            <ProgramCalendarSubscribe
              programId={program.id}
              token={program.calendar_token}
              isOwner={isOwner}
            />
          </p>
          <p className="mt-1 text-xs text-muted">{t("programs.subscribeHint")}</p>
        </>
      )}

      {!readOnly ? (
        <ProgramBuilder
          programId={program.id}
          initialDays={days}
          exercises={exercises ?? []}
          locale={locale}
          startDate={myStart}
          weeks={program.weeks}
          weekPattern={weekPattern}
          previewHref={`/programs/${program.id}?preview=1`}
        />
      ) : (
        <div className="mt-5 flex flex-col gap-3">
          {days.map((d) => {
            const dt = programDayDate(myStart, d.day_index, tag);
            const items = d.workout_templates.reduce(
              (a, w) => a + w.workout_template_items.length,
              0,
            );
            return (
              <section
                key={d.id}
                className={`overflow-hidden rounded-[14px] border bg-card ${
                  d.workout_templates.length ? "border-line" : "border-[#1c1c1c]"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2.5 border-b border-line bg-inset px-4 py-3">
                  <span className="text-[15px] font-extrabold">
                    {t("programs.dayN", { n: d.day_index })}
                  </span>
                  {dt && <span className="text-xs text-[#777]">{dt}</span>}
                  {d.focus && (
                    <span className="min-w-0 flex-1 truncate text-sm">{d.focus}</span>
                  )}
                  <span className="ml-auto shrink-0 text-xs text-muted">
                    {t("programs.dayCounts", {
                      w: d.workout_templates.length,
                      m: items,
                    })}
                  </span>
                </div>

                {d.workout_templates.length ? (
                  <div className="flex flex-col gap-2.5 px-4 py-3">
                    {d.workout_templates.map((w) => (
                      <div key={w.id} className="rounded-xl border border-line bg-page">
                        <div className="flex flex-wrap items-center gap-2.5 border-b border-[#1c1c1c] px-3.5 py-2.5">
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${wodTypeDot(w.type)}`}
                          />
                          <span className="min-w-0 flex-1 truncate text-[15px] font-bold">
                            {w.title}
                          </span>
                          <span className="shrink-0 text-xs text-muted">
                            {t(`programs.type.${w.type}` as DictKey)}
                          </span>
                        </div>
                        {w.workout_template_items.length ? (
                          <ul>
                            {w.workout_template_items
                              .slice()
                              .sort((a, b) => a.seq - b.seq)
                              .map((it, i) => (
                                <li
                                  key={it.id}
                                  className="flex flex-wrap items-center gap-2.5 border-b border-[#161616] px-3.5 py-2 last:border-b-0"
                                >
                                  <span className="tabular w-6 shrink-0 text-right text-xs font-bold text-[#777]">
                                    {i + 1}
                                  </span>
                                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                                    {it.exercises
                                      ? exName(it.exercises)
                                      : (it.pending_exercise ?? "—")}
                                    {!it.exercises && it.pending_exercise && (
                                      <span
                                        title={t("programs.pendingHint")}
                                        className="ml-2 rounded bg-accent/15 px-1.5 py-0.5 align-middle text-[10px] font-bold text-accent"
                                      >
                                        {t("programs.pendingBadge")}
                                      </span>
                                    )}
                                  </span>
                                  <span className="flex flex-wrap items-center gap-1.5 max-md:order-last max-md:w-full max-md:pl-8">
                                    {targetParts(it.target, locale).map((part, j) => (
                                      <span
                                        key={j}
                                        className="tabular flex h-6 items-center rounded-md border border-line-mid bg-[#161616] px-1.5 text-xs font-bold"
                                      >
                                        {part}
                                      </span>
                                    ))}
                                  </span>
                                </li>
                              ))}
                          </ul>
                        ) : (
                          <p className="px-3.5 py-3 text-[13px] text-[#666]">
                            {t("programs.noItems")}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="px-4 py-3 text-[13px] text-[#777]">
                    {t("programs.restDay")}
                  </p>
                )}
              </section>
            );
          })}
          {!days.length && (
            <p className="rounded-[14px] border border-line bg-card px-4 py-10 text-center text-sm text-muted">
              {t("programs.emptyDays")}
            </p>
          )}
        </div>
      )}
    </main>
  );
}
