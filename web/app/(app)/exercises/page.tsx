import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.exercises") };
}

const CATEGORIES = ["strength", "running", "conditioning", "mobility"] as const;
// 시드 04의 장비 어휘 (필터 드롭다운)
const EQUIPMENT = [
  "skierg", "rower", "sled", "kettlebell", "sandbag", "wallball", "barbell",
  "dumbbell", "pullupbar", "airbike", "treadmill", "box", "band", "medball",
  "slamball", "rope", "jumprope", "machine", "trapbar", "yoke", "dipbar",
  "foamroller", "abwheel",
] as const;

export default async function ExercisesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; equipment?: string }>;
}) {
  const { q, category, equipment } = await searchParams;
  const supabase = await createClient();
  const { t, locale } = await getT();

  let query = supabase.from("exercises").select("*").order("station_type", {
    ascending: true,
    nullsFirst: false,
  });
  if (q?.trim()) {
    const term = `%${q.trim()}%`;
    query = query.or(`name_ko.ilike.${term},name_en.ilike.${term}`);
  }
  if (category && (CATEGORIES as readonly string[]).includes(category))
    query = query.eq("category", category);
  if (equipment && (EQUIPMENT as readonly string[]).includes(equipment))
    query = query.contains("equipment", [equipment]);

  const { data: exercises } = await query;

  return (
    <main>
      <h1 className="text-2xl font-bold">{t("exercises.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("exercises.desc")}</p>

      <form method="get" className="mt-6 flex flex-wrap gap-3">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder={t("exercises.searchPh")}
          className="min-w-52 flex-1 rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent"
        />
        <select
          name="category"
          defaultValue={category ?? ""}
          className="rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent"
        >
          <option value="">{t("exercises.allCategories")}</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`exercises.cat.${c}`)}
            </option>
          ))}
        </select>
        <select
          name="equipment"
          defaultValue={equipment ?? ""}
          className="rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent"
        >
          <option value="">{t("exercises.allEquipment")}</option>
          {EQUIPMENT.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-md bg-accent px-5 py-2.5 text-sm font-bold text-background hover:brightness-110"
        >
          {t("common.search")}
        </button>
      </form>

      {!exercises?.length ? (
        <p className="mt-6 rounded-md bg-surface px-4 py-10 text-center text-sm text-muted">
          {t("exercises.noResults")}
        </p>
      ) : (
        <ul className="mt-6 grid gap-2 sm:grid-cols-2">
          {exercises.map((ex) => {
            const primary = locale === "ko" ? ex.name_ko : ex.name_en;
            const secondary = locale === "ko" ? ex.name_en : ex.name_ko;
            return (
              <li key={ex.id} className="rounded-md bg-surface px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{primary}</p>
                  {ex.station_type && (
                    <span className="rounded border border-accent/60 px-1.5 py-0.5 text-xs text-accent">
                      {t("exercises.stationN", {
                        n: ex.station_type.replace("station_", ""),
                      })}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  {secondary}
                  {ex.category
                    ? ` · ${t(`exercises.cat.${ex.category}` as Parameters<typeof t>[0])}`
                    : ""}
                  {ex.equipment?.length ? ` · ${ex.equipment.join(", ")}` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
