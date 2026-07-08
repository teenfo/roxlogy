import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { ProgramBuilder } from "@/components/program-builder";
import { DeleteButton } from "@/components/delete-button";

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

export default async function ProgramDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { t, locale } = await getT();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // RLS: 공용 또는 본인 소유만 조회됨. 트리 전체를 한 번에.
  const { data: program } = await supabase
    .from("programs")
    .select(
      `id, owner_id, title, description, weeks, level, is_public,
       program_days (
         id, day_index, focus, notes,
         workout_templates (
           id, title, type,
           workout_template_items (
             id, seq, target,
             exercises ( name_ko, name_en )
           )
         )
       )`,
    )
    .eq("id", id)
    .maybeSingle();
  if (!program) notFound();

  const isOwner = program.owner_id === user!.id;

  // 소유자면 편집용 운동 목록도 함께 전달
  const { data: exercises } = isOwner
    ? await supabase
        .from("exercises")
        .select("id, name_ko, name_en, station_type")
        .order("station_type", { ascending: true, nullsFirst: false })
    : { data: null };

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
        target: { note?: string } | null;
        exercises: { name_ko: string; name_en: string } | null;
      }[];
    }[];
  };
  const days = ((program.program_days ?? []) as unknown as Day[])
    .slice()
    .sort((a, b) => a.day_index - b.day_index);
  const exName = (ex: { name_ko: string; name_en: string } | null) =>
    ex ? (locale === "ko" ? ex.name_ko : ex.name_en) : "—";

  return (
    <main>
      <div className="flex items-center justify-between">
        <Link href="/programs" className="text-sm text-muted hover:text-foreground">
          {t("programs.back")}
        </Link>
        {isOwner && (
          <DeleteButton kind="program" id={program.id} redirectTo="/programs" />
        )}
      </div>

      <h1 className="mt-4 text-2xl font-bold">{program.title}</h1>
      <p className="mt-1 text-sm text-muted">
        {program.level
          ? t(`predict.level.${program.level}` as Parameters<typeof t>[0])
          : ""}
        {program.weeks ? ` · ${t("programs.weeksN", { n: program.weeks })}` : ""}
        {program.is_public ? ` · ${t("programs.public")}` : ""}
      </p>
      {program.description && (
        <p className="mt-3 whitespace-pre-wrap text-sm">{program.description}</p>
      )}

      {isOwner ? (
        <ProgramBuilder
          programId={program.id}
          initialDays={days}
          exercises={exercises ?? []}
          locale={locale}
        />
      ) : (
        <div className="mt-8 flex flex-col gap-4">
          {days.map((d) => (
            <section key={d.id} className="rounded-md bg-surface p-4">
              <h2 className="font-semibold">
                {t("programs.dayN", { n: d.day_index })}
                {d.focus ? ` · ${d.focus}` : ""}
              </h2>
              {d.notes && <p className="mt-1 text-xs text-muted">{d.notes}</p>}
              <div className="mt-3 flex flex-col gap-3">
                {d.workout_templates.map((w) => (
                  <div key={w.id} className="rounded-md bg-background px-3 py-2.5">
                    <p className="text-sm font-semibold">
                      {w.title}
                      <span className="ml-2 text-xs text-muted">
                        {t(`programs.type.${w.type}` as Parameters<typeof t>[0])}
                      </span>
                    </p>
                    <ul className="mt-1.5 flex flex-col gap-1">
                      {w.workout_template_items
                        .slice()
                        .sort((a, b) => a.seq - b.seq)
                        .map((it) => (
                          <li
                            key={it.id}
                            className="flex justify-between text-xs text-muted"
                          >
                            <span>{exName(it.exercises)}</span>
                            {it.target?.note && (
                              <span className="font-mono">{it.target.note}</span>
                            )}
                          </li>
                        ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {!days.length && (
            <p className="rounded-md bg-surface px-4 py-8 text-center text-sm text-muted">
              {t("programs.emptyDays")}
            </p>
          )}
        </div>
      )}
    </main>
  );
}
