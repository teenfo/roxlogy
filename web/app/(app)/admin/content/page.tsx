import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { AdminExerciseEditor } from "@/components/admin-exercise-editor";
import { AdminProgramActions } from "@/components/admin-program-actions";
import {
  AdminExerciseRequests,
  type ExerciseRequest,
} from "@/components/admin-exercise-requests";

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
    .select("id, name_ko, name_en, muscles, aliases, description_ko, media_url")
    .order("station_type", { ascending: true, nullsFirst: false })
    .limit(40);
  if (q) exQuery = exQuery.or(`name_ko.ilike.%${q}%,name_en.ilike.%${q}%`);
  const { data: exercises } = await exQuery;

  // 운동 등록 요청 (pending) — 관리자 RLS
  const { data: reqRows } = await supabase
    .from("exercise_requests")
    .select("id, name_ko, name_en, note, created_at, profiles ( display_name )")
    .eq("status", "pending")
    .order("created_at");
  type ReqRow = {
    id: string;
    name_ko: string;
    name_en: string | null;
    note: string | null;
    created_at: string;
    profiles: { display_name: string | null } | null;
  };
  const requests: ExerciseRequest[] = (
    (reqRows ?? []) as unknown as ReqRow[]
  ).map((r) => ({
    id: r.id,
    name_ko: r.name_ko,
    name_en: r.name_en,
    note: r.note,
    created_at: r.created_at,
    requester: r.profiles?.display_name ?? "—",
  }));

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
    aliases: string[] | null;
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
              aliases={ex.aliases ?? []}
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
        <h2 className="text-xl font-bold">{t("admin.exReqTitle")}</h2>
        <p className="mt-1 text-sm text-muted">{t("admin.exReqDesc")}</p>
        <div className="mt-4">
          <AdminExerciseRequests items={requests} />
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
