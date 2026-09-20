import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { FollowButton } from "@/components/follow-button";
import { QueryFind } from "@/components/rox/query-filters";
import { Person } from "@/components/rox/person";
import { Empty, Go, Hint, PageHead, Panel } from "@/components/rox/ui";

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

/**
 * 멤버 찾기 — 시안 account.tsx Profile({members}) 그대로 (PORT_PLAN §3-f):
 * PageHead("함께하는 선수들") · Panel[ Find · .rx-switch-row(.rx-person + Go 프로필 보기 | Button 팔로우) · Hint ].
 * 검색은 서버 필터(?q=)라 QueryFind. 팔로워·공유 수는 우리 정보라 이름 아래 작은 줄로(§4).
 */
export default async function MembersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const supabase = await createClient();
  const [{ t }, user] = await Promise.all([getT(), getCachedUser()]);

  const { data } = await supabase.rpc("discover_members", { p_search: q ?? null });
  const members = (data ?? []) as Member[];

  return (
    <>
      <PageHead title={t("members.hero")} description={t("members.heroDesc")} />
      <Panel>
        <QueryFind param="q" value={q ?? ""} placeholder={t("members.searchPh")} />
        {members.length ? (
          members.map((m) => (
            <div className="rx-switch-row" key={m.id}>
              <Person name={m.display_name} note={`${t("members.followers", { n: m.follower_count })}${m.shared_count > 0 ? ` · ${t("members.shared", { n: m.shared_count })}` : ""}`} />
              {m.id === user?.id ? <Go href={`/u/${m.id}`}>{t("members.viewProfile")}</Go> : <FollowButton authorId={m.id} />}
            </div>
          ))
        ) : (
          <Empty title={q ? t("members.emptySearch") : t("members.empty")} description={t("members.desc")} />
        )}
        <Hint>{t("members.desc")}</Hint>
      </Panel>
    </>
  );
}
