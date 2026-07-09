import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { FollowButton } from "@/components/follow-button";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("members.title") };
}

type Member = {
  id: string;
  display_name: string;
  shared_count: number;
  follower_count: number;
  is_following: boolean;
};

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const supabase = await createClient();
  const { t } = await getT();

  const { data } = await supabase.rpc("discover_members", {
    p_search: q ?? null,
  });
  const members = (data ?? []) as Member[];

  return (
    <main>
      <h1 className="text-2xl font-bold">{t("members.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("members.desc")}</p>

      <form className="mt-4" action="/members">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder={t("members.searchPh")}
          className="w-full max-w-sm rounded-md border border-muted/30 bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </form>

      {!members.length ? (
        <p className="mt-6 rounded-md bg-surface px-4 py-10 text-center text-sm text-muted">
          {q ? t("members.emptySearch") : t("members.empty")}
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {members.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between gap-3 rounded-md bg-surface px-4 py-3"
            >
              <div className="min-w-0">
                <Link
                  href={`/u/${m.id}`}
                  className="text-sm font-semibold hover:text-accent"
                >
                  {m.display_name}
                </Link>
                <p className="mt-0.5 text-xs text-muted">
                  {t("members.followers", { n: m.follower_count })}
                  {m.shared_count > 0
                    ? ` · ${t("members.shared", { n: m.shared_count })}`
                    : ""}
                </p>
              </div>
              <FollowButton authorId={m.id} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
