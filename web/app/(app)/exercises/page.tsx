import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "운동 DB — Roxlogy" };

const CATEGORY_LABEL: Record<string, string> = {
  strength: "근력",
  running: "러닝",
  conditioning: "컨디셔닝",
  mobility: "모빌리티",
};

export default async function ExercisesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const { q, category } = await searchParams;
  const supabase = await createClient();

  let query = supabase.from("exercises").select("*").order("station_type", {
    ascending: true,
    nullsFirst: false,
  });
  if (q?.trim()) {
    const term = `%${q.trim()}%`;
    query = query.or(`name_ko.ilike.${term},name_en.ilike.${term}`);
  }
  if (category && CATEGORY_LABEL[category]) query = query.eq("category", category);

  const { data: exercises } = await query;

  return (
    <main>
      <h1 className="text-2xl font-bold">운동 DB</h1>
      <p className="mt-1 text-sm text-muted">
        레이스 스테이션과 훈련 운동 목록입니다. 전체 운동 DB(360+)는 순차
        확충 중입니다.
      </p>

      <form method="get" className="mt-6 flex flex-wrap gap-3">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="한/영 이름 검색"
          className="min-w-52 flex-1 rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent"
        />
        <select
          name="category"
          defaultValue={category ?? ""}
          className="rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent"
        >
          <option value="">전체 분류</option>
          {Object.entries(CATEGORY_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-md bg-accent px-5 py-2.5 text-sm font-bold text-background hover:brightness-110"
        >
          검색
        </button>
      </form>

      {!exercises?.length ? (
        <p className="mt-6 rounded-md bg-surface px-4 py-10 text-center text-sm text-muted">
          검색 결과가 없습니다.
        </p>
      ) : (
        <ul className="mt-6 grid gap-2 sm:grid-cols-2">
          {exercises.map((ex) => (
            <li key={ex.id} className="rounded-md bg-surface px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{ex.name_ko}</p>
                {ex.station_type && (
                  <span className="rounded border border-accent/60 px-1.5 py-0.5 text-xs text-accent">
                    스테이션 {ex.station_type.replace("station_", "")}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted">
                {ex.name_en}
                {ex.category ? ` · ${CATEGORY_LABEL[ex.category] ?? ex.category}` : ""}
                {ex.equipment?.length ? ` · ${ex.equipment.join(", ")}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
