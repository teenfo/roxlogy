import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.programs") };
}

type Program = {
  id: string;
  owner_id: string | null;
  title: string;
  description: string | null;
  weeks: number | null;
  level: string | null;
  is_public: boolean;
};

function ProgramCard({
  p,
  t,
}: {
  p: Program;
  t: Awaited<ReturnType<typeof getT>>["t"];
}) {
  return (
    <li>
      <Link
        href={`/programs/${p.id}`}
        className="flex items-center justify-between rounded-md bg-surface px-4 py-3.5 hover:bg-surface/70"
      >
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">{p.title}</span>
          <span className="text-xs text-muted">
            {p.level
              ? t(`predict.level.${p.level}` as Parameters<typeof t>[0])
              : ""}
            {p.weeks ? ` · ${t("programs.weeksN", { n: p.weeks })}` : ""}
            {p.is_public ? ` · ${t("programs.public")}` : ""}
          </span>
        </div>
      </Link>
    </li>
  );
}

export default async function ProgramsPage() {
  const supabase = await createClient();
  const { t } = await getT();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // RLS: 공용(is_public) 또는 본인 소유만 조회됨
  const { data: programs } = await supabase
    .from("programs")
    .select("id, owner_id, title, description, weeks, level, is_public")
    .order("created_at", { ascending: false });

  const mine = (programs ?? []).filter((p) => p.owner_id === user!.id);
  const community = (programs ?? []).filter(
    (p) => p.owner_id !== user!.id && p.is_public,
  );

  return (
    <main>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("programs.title")}</h1>
        <Link
          href="/programs/new"
          className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-background hover:brightness-110"
        >
          {t("programs.create")}
        </Link>
      </div>
      <p className="mt-1 text-sm text-muted">{t("programs.desc")}</p>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">{t("programs.mine")}</h2>
        {!mine.length ? (
          <p className="mt-3 rounded-md bg-surface px-4 py-8 text-center text-sm text-muted">
            {t("programs.mineEmpty")}
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {mine.map((p) => (
              <ProgramCard key={p.id} p={p} t={t} />
            ))}
          </ul>
        )}
      </section>

      {community.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">{t("programs.community")}</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {community.map((p) => (
              <ProgramCard key={p.id} p={p} t={t} />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
