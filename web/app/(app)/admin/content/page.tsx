import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { AdminExerciseEditor } from "@/components/admin-exercise-editor";
import { AdminProgramActions } from "@/components/admin-program-actions";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("admin.tabContent") };
}

export default async function AdminContentPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const supabase = await createClient();
  const { t, locale } = await getT();

  let exQuery = supabase
    .from("exercises")
    .select("id, name_ko, name_en, muscles, description_ko, media_url")
    .order("station_type", { ascending: true, nullsFirst: false })
    .limit(40);
  if (q) exQuery = exQuery.or(`name_ko.ilike.%${q}%,name_en.ilike.%${q}%`);
  const { data: exercises } = await exQuery;

  const { data: programs } = await supabase
    .from("programs")
    .select("id, title, owner_id")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(50);

  type Ex = {
    id: string;
    name_ko: string;
    name_en: string;
    muscles: string[] | null;
    description_ko: string | null;
    media_url: string | null;
  };
  const exs = (exercises ?? []) as Ex[];

  return (
    <main className="flex flex-col gap-10">
      <section>
        <h1 className="text-xl font-bold">{t("admin.exercisesTitle")}</h1>
        <p className="mt-1 text-sm text-muted">{t("admin.exercisesDesc")}</p>
        <form className="mt-4" action="/admin/content">
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder={t("exercises.searchPh")}
            className="w-full max-w-sm rounded-md border border-muted/30 bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </form>
        <div className="mt-4 flex flex-col gap-2">
          {exs.map((ex) => (
            <AdminExerciseEditor
              key={ex.id}
              id={ex.id}
              name={locale === "ko" ? ex.name_ko : ex.name_en}
              muscles={ex.muscles ?? []}
              description={ex.description_ko}
              mediaUrl={ex.media_url}
            />
          ))}
          {!exs.length && (
            <p className="rounded-md bg-surface px-4 py-8 text-center text-sm text-muted">
              {t("admin.noExercises")}
            </p>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-bold">{t("admin.publicProgramsTitle")}</h2>
        <div className="mt-4 flex flex-col gap-2">
          {(programs ?? []).map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-md bg-surface px-4 py-3"
            >
              <Link
                href={`/programs/${p.id}`}
                className="text-sm font-medium hover:text-accent"
              >
                {p.title}
              </Link>
              <AdminProgramActions programId={p.id} />
            </div>
          ))}
          {!programs?.length && (
            <p className="rounded-md bg-surface px-4 py-8 text-center text-sm text-muted">
              {t("admin.noPublicPrograms")}
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
