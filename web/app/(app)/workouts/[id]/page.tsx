import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import {
  WorkoutChecklist,
  type ChecklistItem,
} from "@/components/workout-checklist";
import { targetParts, type WorkoutTarget } from "@/lib/target";
import { dictLabel } from "@/lib/dict-label";
import { wodTypeChip } from "@/lib/wod-type";

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
  target: WorkoutTarget | null;
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
      targetParts: targetParts(it.target, locale),
    };
  });

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-3.5">
      {/* 브레드크럼 */}
      <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
        <Link
          href="/schedule"
          className="transition-colors hover:text-foreground"
        >
          ← {t("schedule.title")}
        </Link>
        {program && (
          <>
            <span aria-hidden>/</span>
            <Link
              href={`/programs/${program.id}`}
              className="transition-colors hover:text-foreground"
            >
              {program.title}
            </Link>
          </>
        )}
        {day && (
          <>
            <span aria-hidden>/</span>
            <span className="text-foreground/75">
              {t("programs.dayN", { n: day.day_index })}
            </span>
          </>
        )}
      </p>

      <WorkoutChecklist
        items={checklist}
        initialCompletions={completions}
        hero={
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-5 px-6 py-[22px] max-md:grid-cols-1 max-md:px-4">
            <div className="flex min-w-0 flex-col gap-2.5">
              <p className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-[5px] px-2 py-[3px] text-[11px] font-bold ${wodTypeChip(w.type)}`}
                >
                  {dictLabel(t, `programs.type.${w.type}`, w.type)}
                </span>
                {day?.focus && (
                  <span className="min-w-0 truncate text-xs text-muted">
                    {day.focus}
                  </span>
                )}
              </p>
              <h1 className="text-[28px] font-extrabold tracking-[-0.02em] [word-break:keep-all] max-md:text-2xl">
                {w.title}
              </h1>
              <p className="text-[13px] text-muted">
                {t("workouts.itemsN", { n: checklist.length })}
              </p>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-1.5 max-md:items-stretch">
              <Link
                href="/sessions/new"
                className="flex h-11 items-center justify-center rounded-lg bg-accent px-5 text-[15px] font-extrabold text-background transition hover:brightness-110"
              >
                ◔ {t("workouts.recordAsSession")}
              </Link>
              <span className="text-xs text-muted [word-break:keep-all]">
                {t("workouts.autoSegments")}
              </span>
            </div>
          </div>
        }
      />
    </main>
  );
}
