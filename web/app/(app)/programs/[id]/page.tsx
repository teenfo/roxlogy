import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { formatDateShort, programDayDate } from "@/lib/format";
import { targetParts, type WorkoutTarget } from "@/lib/target";
import { ProgramBuilder } from "@/components/program-builder";
import { ProgramBasicsEditor } from "@/components/program-basics-editor";
import { ProgramCalendarSubscribe } from "@/components/program-calendar-subscribe";
import { ProgramEnrollButton } from "@/components/program-enroll-button";
import { CloneProgramButton } from "@/components/clone-program-button";
import { DeleteButton } from "@/components/delete-button";
import type { DictKey } from "@/lib/i18n/dictionaries/en";
import {
  Back,
  Chip,
  DataTable,
  Empty,
  Go,
  Hint,
  PageHead,
  Panel,
  RecordRow,
} from "@/components/rox/ui";

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

/**
 * 프로그램 상세 — 시안 training.tsx ProgramDetail 그대로 (PORT_PLAN §3-c):
 * Back · PageHead(시작/보관) · two-col[Panel "훈련 계획"(일차별 운동 행) | Panel "프로그램 정보"
 * DataTable + Go 주간 일정]. 소유자 편집(ProgramBuilder 1,232줄)·복제·삭제·캘린더 구독은
 * 시안에 없는 우리 기능이라 Panel 로만 감싼다(§4-1). 미리보기(?preview=1) 조건은 확정 2.
 */
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
  // 소유자도 "남에게 어떻게 보이는지"를 볼 수 있어야 한다 — 확정 2: 로그인한 비소유자 시점
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

  const description = [
    program.weeks ? t("programs.weeksN", { n: program.weeks }) : null,
    perWeek ? t("programs.perWeek", { n: perWeek }) : null,
    program.level ? t(`predict.level.${program.level}` as DictKey) : null,
    program.is_public ? t("programs.public") : t("programs.private"),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <Back href="/programs" label={t("programs.title")} />
      <PageHead
        title={program.title}
        description={description}
        action={
          <div className="rx-actions">
            {isOwner && preview === "1" && (
              <Go href={`/programs/${program.id}`}>{t("programs.backToBuilder")}</Go>
            )}
            {readOnly && <CloneProgramButton programId={program.id} title={program.title} />}
            <ProgramEnrollButton
              programId={program.id}
              initialActive={isEnrolled}
              totalDays={totalDays}
            />
            {!readOnly && (
              <DeleteButton kind="program" id={program.id} redirectTo="/programs" />
            )}
          </div>
        }
      />

      {program.description && (
        <div className="rx-notice">
          <div>
            <p style={{ whiteSpace: "pre-wrap" }}>{program.description}</p>
          </div>
        </div>
      )}

      {!readOnly && (
        <ProgramBasicsEditor
          programId={program.id}
          title={program.title}
          description={program.description}
          weeks={program.weeks}
          level={program.level}
          isPublic={program.is_public}
        />
      )}

      <div className="rx-two-col">
        <Panel
          title={t("programs.builderStats", { d: totalDays, w: workoutCount, m: itemCount })}
          action={isEnrolled ? <Chip tone="green">{t("programs.running")}</Chip> : undefined}
        >
          {days.length ? (
            days.map((d) => {
              const dt = programDayDate(myStart, d.day_index, tag);
              return (
                <div key={d.id}>
                  <div className="rx-section-label">
                    {t("programs.dayN", { n: d.day_index })}
                    {dt ? ` · ${dt}` : ""}
                    {d.focus ? ` · ${d.focus}` : ""}
                  </div>
                  {d.workout_templates.length ? (
                    d.workout_templates.map((w) => (
                      <RecordRow
                        key={w.id}
                        href={`/workouts/${w.id}`}
                        title={w.title}
                        note={[
                          t(`programs.type.${w.type}` as DictKey),
                          w.workout_template_items.length
                            ? w.workout_template_items
                                .slice()
                                .sort((a, b) => a.seq - b.seq)
                                .map((it) =>
                                  it.exercises
                                    ? `${exName(it.exercises)} ${targetParts(it.target, locale).join(" ")}`
                                    : (it.pending_exercise ?? "—"),
                                )
                                .join(" · ")
                            : t("programs.noItems"),
                        ].join(" · ")}
                      />
                    ))
                  ) : (
                    <Hint>{t("programs.restDay")}</Hint>
                  )}
                </div>
              );
            })
          ) : (
            <Empty title={t("programs.emptyDays")} description={t("programs.intro")} />
          )}
        </Panel>
        <Panel title={t("programs.info")}>
          <DataTable
            headers={[t("programs.field"), t("programs.value")]}
            rows={[
              [t("programs.weeksN", { n: program.weeks ?? 0 }), perWeek ? t("programs.perWeek", { n: perWeek }) : "—"],
              [t("programs.running"), isEnrolled ? t("programs.running") : "—"],
              [t("programs.public"), program.is_public ? t("programs.public") : t("programs.private")],
              ...(myStart
                ? [[
                    t("programs.mySchedule"),
                    `${formatDateShort(myStart, tag, tz)}${myEnd ? ` – ${formatDateShort(myEnd, tag, tz)}` : ""}${myRepeat ? " 🔁" : ""}`,
                  ]]
                : []),
            ]}
          />
          {myStart && (
            <div className="rx-actions" style={{ padding: "0 24px" }}>
              <Go href={`/programs/${program.id}/calendar.ics`}>
                <CalendarDays size={17} />
                {t("programs.icsDownload")}
              </Go>
              <ProgramCalendarSubscribe
                programId={program.id}
                token={program.calendar_token}
                isOwner={!readOnly}
              />
            </div>
          )}
          {myStart && <Hint>{t("programs.subscribeHint")}</Hint>}
          <div style={{ padding: "0 24px 24px" }}>
            <Go href="/schedule">
              <CalendarDays size={17} />
              {t("schedule.title")}
            </Go>
          </div>
        </Panel>
      </div>

      {!readOnly && (
        <Panel title={t("programs.backToBuilder")} action={<Link href={`/programs/${program.id}?preview=1`}>{t("programs.previewLink")}</Link>}>
          <div style={{ padding: "0 24px 24px" }}>
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
          </div>
        </Panel>
      )}
    </>
  );
}
