import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import {
  WorkoutChecklist,
  type ChecklistItem,
} from "@/components/workout-checklist";
import type { ItemSet } from "@/components/workout-sets";
import { targetParts, type WorkoutTarget } from "@/lib/target";
import { dictLabel } from "@/lib/dict-label";
import { Back, Chip, Go, Hint, PageHead, Panel } from "@/components/rox/ui";

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
  pending_exercise: string | null;
};

type CompRow = {
  item_id: string;
  weight_kg: number | null;
  reps: number | null;
  note: string | null;
};

type SetDbRow = {
  id: string;
  item_id: string;
  set_no: number;
  reps: number | null;
  weight_kg: number | null;
  distance_m: number | null;
  duration_s: number | null;
};

/**
 * 운동 상세 — 시안 training.tsx 의 Workout 그대로 (PORT_PLAN §3-c):
 * Back · PageHead(세션으로 기록) · .rx-form-layout[Panel "오늘의 운동" | aside].
 * 체크리스트·세트 기록(WorkoutChecklist)은 시안보다 많은 우리 기능이라 Panel 안에 그대로.
 */
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
       workout_template_items ( id, seq, target, pending_exercise, exercises ( id, name_ko, name_en ) )`,
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
  const [{ data: compRows }, { data: setRows, error: setErr }] = itemIds.length
    ? await Promise.all([
        supabase
          .from("workout_item_completions")
          .select("item_id, weight_kg, reps, note")
          .in("item_id", itemIds),
        supabase
          .from("workout_item_sets")
          .select("id, item_id, set_no, reps, weight_kg, distance_m, duration_s")
          .in("item_id", itemIds)
          .order("set_no"),
      ])
    : [{ data: [] as CompRow[] }, { data: [] as SetDbRow[], error: null }];
  // 조회가 실패했는데 "기록 없음"으로 보이면 사용자가 덮어써 잃는다 — 시끄럽게 실패시킨다
  if (setErr) throw new Error(setErr.message);
  const completions = ((compRows ?? []) as CompRow[]).map((r) => ({
    itemId: r.item_id,
    weightKg: r.weight_kg,
    reps: r.reps,
    note: r.note,
  }));
  const initialSets: ItemSet[] = ((setRows ?? []) as SetDbRow[]).map((r) => ({
    id: r.id,
    itemId: r.item_id,
    setNo: r.set_no,
    reps: r.reps,
    weightKg: r.weight_kg,
    distanceM: r.distance_m,
    durationS: r.duration_s,
  }));

  const checklist: ChecklistItem[] = items.map((it) => {
    const exRaw = it.exercises as unknown;
    const ex = (Array.isArray(exRaw) ? exRaw[0] : exRaw) as
      | { id: string; name_ko: string; name_en: string }
      | null;
    return {
      id: it.id,
      name: ex
        ? locale === "ko"
          ? ex.name_ko
          : ex.name_en
        : it.pending_exercise
          ? `${it.pending_exercise} (${t("programs.pendingBadge")})`
          : "—",
      exerciseId: ex?.id ?? null,
      targetParts: targetParts(it.target, locale),
      target: it.target ?? null,
    };
  });

  return (
    <>
      <Back
        href={program ? `/programs/${program.id}` : "/schedule"}
        label={program ? program.title : t("schedule.title")}
      />
      <PageHead
        title={w.title}
        description={[
          dictLabel(t, `programs.type.${w.type}`, w.type),
          t("workouts.itemsN", { n: checklist.length }),
          day ? t("programs.dayN", { n: day.day_index }) : null,
          day?.focus,
        ]
          .filter(Boolean)
          .join(" · ")}
        action={<Go href="/sessions/new">{t("workouts.recordAsSession")}</Go>}
      />
      <div className="rx-form-layout">
        <Panel
          title={t("workouts.today")}
          action={<Chip>{dictLabel(t, `programs.type.${w.type}`, w.type)}</Chip>}
        >
          <div>
            <WorkoutChecklist
              items={checklist}
              initialCompletions={completions}
              initialSets={initialSets}
              hero={null}
            />
          </div>
        </Panel>
        <aside>
          <Panel title={t("workouts.recordAsSession")}>
            <p className="rx-hint">
              {t("workouts.autoSegments")}
            </p>
            <Hint>{day?.focus ?? ""}</Hint>
            <div>
              <Go href="/sessions/new" primary>
                {t("workouts.recordAsSession")}
              </Go>
            </div>
          </Panel>
        </aside>
      </div>
    </>
  );
}
