import Link from "next/link";
import { ArrowRight, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getMyCrews } from "@/lib/crew";
import { getT } from "@/lib/i18n";
import { formatDate, formatMs } from "@/lib/format";
import { QuerySegments } from "@/components/rox/query-filters";
import { Empty, Go, Hint, PageHead, Panel, RecordRow } from "@/components/rox/ui";

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

/**
 * 커뮤니티 피드 — 시안 account.tsx Feed() 그대로 (PORT_PLAN §3-f):
 * PageHead(+ Go 멤버 찾기) · Segments(둘러보기 · 팔로잉) · .rx-feed-layout[ Panel(.rx-person · .rx-feed-record · .rx-actions Go) 목록
 * | Panel "이번 주 크루"(RowLink 내 크루) ]. 탭은 서버 필터라 QuerySegments(?tab=). 좋아요는 시안에만 있는 미리보기라 뺐다.
 */
export default async function FeedPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const following = tab === "following";
  const supabase = await createClient();
  const { t, tag, tz } = await getT();

  const [{ data: rows }, mine] = await Promise.all([supabase.rpc("community_feed", { p_following: following, p_limit: 50 }), getMyCrews()]);
  const feed = (rows ?? []) as FeedRow[];

  return (
    <>
      <PageHead
        title={t("feed.hero")}
        description={t("feed.desc")}
        action={
          <Go href="/members">
            <Users size={16} />
            {t("feed.findMembers")}
          </Go>
        }
      />
      <QuerySegments
        label={t("feed.title")}
        param="tab"
        value={following ? "following" : "discover"}
        defaultValue="discover"
        options={[
          ["discover", t("feed.discover")],
          ["following", t("feed.followingTab")],
        ]}
      />
      <div className="rx-feed-layout">
        <div>
          {!feed.length ? (
            <Panel>
              <Empty title={following ? t("feed.emptyFollowing") : t("feed.emptyDiscover")} description={t("feed.desc")} />
            </Panel>
          ) : (
            feed.map((r) => (
              <Panel key={r.session_id}>
                <div className="rx-person">
                  <span className="rx-avatar" aria-hidden>
                    {(r.author_name.trim()[0] ?? "?").toUpperCase()}
                  </span>
                  <div>
                    <Link href={`/u/${r.author_id}`}>
                      <b>{r.author_name}</b>
                    </Link>
                    <small className="rx-block rx-muted">
                      {formatDate(r.started_at, tag, tz)} · {t("feed.sessionRecord")}
                    </small>
                  </div>
                </div>
                <Link className="rx-feed-record" href={`/sessions/${r.session_id}`}>
                  <div>
                    <span>FINISH LINE CROSSED</span>
                    <h2>{t("feed.sessionRecord")}</h2>
                  </div>
                  <strong>{formatMs(r.total_time_ms)}</strong>
                </Link>
                <div className="rx-actions">
                  <Go href={`/sessions/${r.session_id}`}>
                    {t("feed.viewRecord")} <ArrowRight size={16} />
                  </Go>
                </div>
              </Panel>
            ))
          )}
        </div>
        <Panel title={t("feed.crewsThisWeek")}>
          {mine.length ? (
            mine.map((c) => (
              <RecordRow
                key={c.slug}
                href={`/crews/${c.slug}`}
                title={c.name}
                note={c.next_event ? `${t("crew.nextMeetup")} · ${formatDate(c.next_event.starts_at, tag, tz)} · ${c.next_event.title}` : `${c.member_count} ${t("crew.members")}${c.location ? ` · ${c.location}` : ""}`}
              />
            ))
          ) : (
            <Hint>
              {t("feed.noCrew")} <Link href="/crews">{t("nav.crews")}</Link>
            </Hint>
          )}
        </Panel>
      </div>
    </>
  );
}
