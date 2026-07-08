import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { formatDate, formatMs } from "@/lib/format";
import { FollowButton } from "@/components/follow-button";

type PublicProfile = {
  display_name: string | null;
  division: string | null;
  shared_count: number;
  leaderboard_opt_in: boolean;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("public_profile", { p_user: id });
  const row = (data?.[0] ?? null) as PublicProfile | null;
  return { title: row?.display_name ? `${row.display_name} — Roxlogy` : "Roxlogy" };
}

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { t, tag } = await getT();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profRows } = await supabase.rpc("public_profile", {
    p_user: id,
  });
  const profile = (profRows?.[0] ?? null) as PublicProfile | null;
  if (!profile) notFound();

  const { data: shared } = await supabase
    .from("sessions")
    .select("id, started_at, total_time_ms")
    .eq("user_id", id)
    .eq("shared", true)
    .is("deleted_at", null)
    .order("started_at", { ascending: false })
    .limit(30);

  const isSelf = user?.id === id;
  const name = profile.display_name || t("profile.anon");

  return (
    <main>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{name}</h1>
          {profile.division && (
            <p className="mt-1 text-sm text-muted">
              {t(`division.${profile.division}` as Parameters<typeof t>[0])}
            </p>
          )}
        </div>
        {!isSelf && <FollowButton authorId={id} />}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className="rounded-full bg-surface px-3 py-1 text-xs text-muted">
          {t("pub.sharedN", { n: profile.shared_count })}
        </span>
        {profile.leaderboard_opt_in && (
          <span className="rounded-full bg-track/15 px-3 py-1 text-xs font-semibold text-track">
            {t("pub.leaderboardMember")}
          </span>
        )}
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">{t("pub.sharedSessions")}</h2>
        {!shared?.length ? (
          <p className="mt-3 rounded-md bg-surface px-4 py-8 text-center text-sm text-muted">
            {t("pub.noShared")}
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {shared.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/sessions/${s.id}`}
                  className="flex items-center justify-between rounded-md bg-surface px-4 py-3.5 hover:bg-surface/70"
                >
                  <span className="text-sm">{formatDate(s.started_at, tag)}</span>
                  <span className="font-mono text-lg font-semibold text-accent">
                    {formatMs(s.total_time_ms)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
