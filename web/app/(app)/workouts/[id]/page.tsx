import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import {
  WorkoutChecklist,
  type ChecklistItem,
} from "@/components/workout-checklist";

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

type CompRow = {
  item_id: string;
  weight_kg: number | null;
  reps: number | null;
  note: string | null;
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

  // 이 WOD의 아이템 중 내가 완료한 것 + 수행 기록 (RLS: 본인 것만 조회됨)
  const itemIds = items.map((it) => it.id);
  const { data: compRows } = itemIds.length
    ? await supabase
        .from("workout_item_completions")
        .select("item_id, weight_kg, reps, note")
        .in("item_id", itemIds)
    : { data: [] as CompRow[] };
  const completions = ((compRows ?? []) as CompRow[]).map((r) => ({
    itemId: r.item_id,
    weightKg: r.weight_kg,
    reps: r.reps,
    note: r.note,
  }));

  const checklist: ChecklistItem[] = items.map((it) => {
    const exRaw = it.exercises as unknown;
    const ex = (Array.isArray(exRaw) ? exRaw[0] : exRaw) as
      | { id: string; name_ko: string; name_en: string }
      | null;
    return {
      id: it.id,
      name: ex ? (locale === "ko" ? ex.name_ko : ex.name_en) : "—",
      exerciseId: ex?.id ?? null,
      targetNote: it.target?.note ?? null,
    };
  });

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

      <WorkoutChecklist items={checklist} initialCompletions={completions} />
    </main>
  );
}
