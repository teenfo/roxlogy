import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { formatDate, formatMs } from "@/lib/format";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.feed") };
}

type FeedRow = {
  session_id: string;
  author_id: string;
  author_name: string;
  started_at: string;
  total_time_ms: number | null;
};

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const following = tab === "following";
  const supabase = await createClient();
  const { t, tag } = await getT();

  const { data: rows } = await supabase.rpc("community_feed", {
    p_following: following,
    p_limit: 50,
  });
  const feed = (rows ?? []) as FeedRow[];

  const tabCls = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs ${active ? "border-accent text-accent" : "border-muted/40 text-muted hover:border-foreground"}`;

  return (
    <main>
      <h1 className="text-2xl font-bold">{t("feed.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("feed.desc")}</p>

      <div className="mt-6 flex gap-2">
        <Link href="/feed" className={tabCls(!following)}>
          {t("feed.discover")}
        </Link>
        <Link href="/feed?tab=following" className={tabCls(following)}>
          {t("feed.followingTab")}
        </Link>
      </div>

      {!feed.length ? (
        <p className="mt-6 rounded-md bg-surface px-4 py-10 text-center text-sm text-muted">
          {following ? t("feed.emptyFollowing") : t("feed.emptyDiscover")}
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {feed.map((r) => (
            <li
              key={r.session_id}
              className="flex items-center justify-between rounded-md bg-surface px-4 py-3.5"
            >
              <div className="flex flex-col gap-0.5">
                <Link
                  href={`/u/${r.author_id}`}
                  className="text-sm font-semibold hover:text-accent"
                >
                  {r.author_name}
                </Link>
                <span className="text-xs text-muted">
                  {formatDate(r.started_at, tag)}
                </span>
              </div>
              <Link
                href={`/sessions/${r.session_id}`}
                className="font-mono text-lg font-semibold text-accent hover:underline"
              >
                {formatMs(r.total_time_ms)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
