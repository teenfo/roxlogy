import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { formatDate, formatMs } from "@/lib/format";
import { dictLabel } from "@/lib/dict-label";
import { FollowButton } from "@/components/follow-button";
import { Button } from "@/components/ui/button";
import { Chip, Empty, PageHead, Panel, RecordRow } from "@/components/rox/ui";

type PublicProfile = {
  display_name: string | null;
  division: string | null;
  shared_count: number;
  leaderboard_opt_in: boolean;
  instagram: string | null;
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("public_profile", { p_user: id });
  const row = (data?.[0] ?? null) as PublicProfile | null;
  return { title: row?.display_name ? `${row.display_name} — Roxlogy` : "Roxlogy" };
}

/**
 * 공개 프로필 — 시안 account.tsx Profile() 그대로 (PORT_PLAN §3-f):
 * PageHead(이름, "크루 · 공유한 기록 N개") · Panel[ RowLink(기록) ]. 팔로우·인스타·리더보드 칩은 우리 것(§4).
 */
export default async function PublicProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ t, tag, tz }, user, { data: profRows }] = await Promise.all([getT(), getCachedUser(), supabase.rpc("public_profile", { p_user: id })]);
  const profile = (profRows?.[0] ?? null) as PublicProfile | null;
  if (!profile) notFound();

  // 공유한 세션만 — 남의 데이터라 shared 필터가 곧 권한이다(RLS 도 같은 조건)
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
  const division = profile.division ? dictLabel(t, `division.${profile.division}`, profile.division) : null;

  return (
    <>
      <PageHead title={name} description={[division, t("pub.sharedN", { n: profile.shared_count })].filter(Boolean).join(" · ")} action={!isSelf ? <FollowButton authorId={id} /> : undefined} />
      {(profile.leaderboard_opt_in || profile.instagram) && (
        <div className="rx-actions" style={{ marginTop: 0, marginBottom: 20 }}>
          {profile.leaderboard_opt_in && <Chip tone="blue">{t("pub.leaderboardMember")}</Chip>}
          {profile.instagram && (
            <Button asChild variant="outline" size="sm">
              <a href={`https://instagram.com/${profile.instagram}`} target="_blank" rel="noreferrer noopener">
                @{profile.instagram}
              </a>
            </Button>
          )}
        </div>
      )}
      <Panel title={t("pub.records")}>
        {!shared?.length ? (
          <Empty title={t("pub.noShared")} description={t("pub.sharedSessions")} />
        ) : (
          shared.map((s) => <RecordRow key={s.id} href={`/sessions/${s.id}`} title={formatDate(s.started_at, tag, tz)} note={t("feed.sessionRecord")} end={formatMs(s.total_time_ms)} />)
        )}
      </Panel>
    </>
  );
}
