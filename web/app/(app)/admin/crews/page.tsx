import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { AdminCrewStatus } from "@/components/admin-crew-status";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("admin.crewsTitle") };
}

type CrewRow = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  location: string | null;
  join_policy: string;
  status: "pending" | "active" | "rejected";
  created_at: string;
};

export default async function AdminCrewsPage() {
  const supabase = await createClient();
  const { t } = await getT();
  // 관리자는 RLS(crews_select_public 의 is_admin 분기)로 전체 크루 조회 가능
  const { data } = await supabase
    .from("crews")
    .select("id, slug, name, tagline, location, join_policy, status, created_at")
    .order("created_at", { ascending: false });
  const crews = (data ?? []) as CrewRow[];
  const pending = crews.filter((c) => c.status === "pending");
  const rest = crews.filter((c) => c.status !== "pending");

  return (
    <main>
      <h1 className="text-xl font-bold">{t("admin.crewsTitle")}</h1>

      <h2 className="mt-5 text-sm font-semibold text-muted">
        {t("admin.crewsPending")} ({pending.length})
      </h2>
      {!pending.length ? (
        <p className="mt-2 rounded-md bg-surface px-4 py-6 text-center text-sm text-muted">
          {t("admin.crewsEmpty")}
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {pending.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-surface px-4 py-3"
            >
              <div className="min-w-0">
                <Link
                  href={`/crews/${c.slug}`}
                  className="text-sm font-bold hover:text-accent"
                >
                  {c.name}
                </Link>
                <p className="mt-0.5 text-xs text-muted">
                  /{c.slug} · {c.join_policy}
                  {c.location ? ` · ${c.location}` : ""}
                </p>
              </div>
              <AdminCrewStatus crewId={c.id} />
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-8 text-sm font-semibold text-muted">
        {t("admin.crewsAll")} ({rest.length})
      </h2>
      <ul className="mt-2 flex flex-col gap-1">
        {rest.map((c) => (
          <li
            key={c.id}
            className="flex items-center justify-between rounded-md bg-surface px-4 py-2"
          >
            <Link
              href={`/crews/${c.slug}`}
              className="truncate text-sm hover:text-accent"
            >
              {c.name}
              <span className="ml-2 text-xs text-muted">/{c.slug}</span>
            </Link>
            <span
              className={`text-xs ${
                c.status === "active" ? "text-track" : "text-red-400"
              }`}
            >
              {c.status}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
