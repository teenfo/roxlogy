import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("workout_templates")
    .select("title")
    .eq("id", id)
    .maybeSingle();
  return { title: data ? `${data.title} — Roxlogy` : "Roxlogy" };
}

type Item = {
  id: string;
  seq: number;
  target: { note?: string } | null;
  exercises: { id: string; name_ko: string; name_en: string } | null;
};

export default async function WorkoutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { t, locale } = await getT();

  const { data: w } = await supabase
    .from("workout_templates")
    .select(
      `id, title, type,
       program_days ( day_index, focus, programs ( id, title ) ),
       workout_template_items ( id, seq, target, exercises ( id, name_ko, name_en ) )`,
    )
    .eq("id", id)
    .maybeSingle();
  if (!w) notFound();

  const dayRaw = (w as { program_days?: unknown }).program_days;
  const day = (Array.isArray(dayRaw) ? dayRaw[0] : dayRaw) as
    | {
        day_index: number;
        focus: string | null;
        programs:
          | { id: string; title: string }
          | { id: string; title: string }[]
          | null;
      }
    | null;
  const progRaw = day?.programs;
  const program = (Array.isArray(progRaw) ? progRaw[0] : progRaw) as
    | { id: string; title: string }
    | null;

  const items = ((w.workout_template_items ?? []) as unknown as Item[])
    .slice()
    .sort((a, b) => a.seq - b.seq);
  const exName = (ex: Item["exercises"]) =>
    ex ? (locale === "ko" ? ex.name_ko : ex.name_en) : "—";

  return (
    <main>
      <Link
        href={program ? `/programs/${program.id}` : "/schedule"}
        className="text-sm text-muted hover:text-foreground"
      >
        {program ? program.title : t("schedule.title")}
      </Link>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">{w.title}</h1>
        <Link
          href="/sessions/new"
          className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-background hover:brightness-110"
        >
          {t("workouts.record")}
        </Link>
      </div>
      <p className="mt-1 text-sm text-muted">
        {t(`programs.type.${w.type}` as Parameters<typeof t>[0])}
        {day ? ` · ${t("programs.dayN", { n: day.day_index })}` : ""}
        {day?.focus ? ` · ${day.focus}` : ""}
      </p>

      {items.length === 0 ? (
        <p className="mt-6 rounded-md bg-surface px-4 py-10 text-center text-sm text-muted">
          {t("workouts.noItems")}
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-1.5">
          {items.map((it, i) => (
            <li
              key={it.id}
              className="flex items-center gap-3 rounded-md bg-surface px-4 py-2.5"
            >
              <span className="w-6 text-right font-mono text-xs text-muted">
                {i + 1}
              </span>
              {it.exercises ? (
                <Link
                  href={`/exercises/${it.exercises.id}`}
                  className="flex-1 truncate text-sm font-medium hover:text-accent"
                >
                  {exName(it.exercises)}
                </Link>
              ) : (
                <span className="flex-1 truncate text-sm font-medium">—</span>
              )}
              {it.target?.note && (
                <span className="shrink-0 rounded bg-accent/15 px-2 py-0.5 font-mono text-xs font-semibold text-accent">
                  {it.target.note}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
