import Link from "next/link";
import { getExercises } from "@/lib/cache";
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
  const { t, locale } = await getT();

  // 운동 DB 는 전역 참조 데이터 — 전역 캐시(1시간) 후 필터는 메모리에서
  const allExercises = await getExercises();
  const term = q?.trim().toLowerCase();
  const exercises = allExercises.filter((e) => {
    if (category && (CATEGORIES as readonly string[]).includes(category) && e.category !== category)
      return false;
    if (
      equipment &&
      (EQUIPMENT as readonly string[]).includes(equipment) &&
      !(e.equipment ?? []).includes(equipment)
    )
      return false;
    if (!term) return true;
    return [e.name_ko, e.name_en].some((v) =>
      (v ?? "").toLowerCase().includes(term),
    );
  });

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
              <li key={ex.id}>
                <Link
                  href={`/exercises/${ex.id}`}
                  className="block rounded-md bg-surface px-4 py-3 hover:bg-surface/70"
                >
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
                  {((Array.isArray(ex.muscles) && ex.muscles.length > 0) ||
                    (Array.isArray(ex.helps_stations) &&
                      ex.helps_stations.length > 0)) && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {(ex.muscles ?? []).map((m: string) => (
                        <span
                          key={`m-${m}`}
                          className="rounded-full bg-track/15 px-2 py-0.5 text-[10px] font-semibold text-track"
                        >
                          {t(`muscle.${m}` as Parameters<typeof t>[0])}
                        </span>
                      ))}
                      {(ex.helps_stations ?? []).map((h: string) => (
                        <span
                          key={`h-${h}`}
                          className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent"
                        >
                          {t(`hstation.${h}` as Parameters<typeof t>[0])}
                        </span>
                      ))}
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
