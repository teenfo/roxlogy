import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { FollowButton } from "@/components/follow-button";
import { RowLink } from "@/components/row-link";

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
      <h1 className="text-[30px] font-extrabold leading-[1.4] tracking-[-1px] max-[1000px]:text-[27px] max-[600px]:text-[25px]">{t("members.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("members.desc")}</p>

      <form className="mt-4" action="/members">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder={t("members.searchPh")}
          className="w-full max-w-sm rounded-md border border-line-mid bg-surface px-3 py-2 text-sm outline-none focus:border-accent-line"
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
                <RowLink
                  href={`/u/${m.id}`}
                  className="text-sm font-semibold hover:text-gold"
                >
                  {m.display_name}
                </RowLink>
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
