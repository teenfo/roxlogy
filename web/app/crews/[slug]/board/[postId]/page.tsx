import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCrew, isActiveMember, type CrewPostDetail } from "@/lib/crew";
import { getT } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { CrewLikeButton } from "@/components/crew-like-button";
import { CrewCommentForm } from "@/components/crew-comment-form";
import { CrewPostActions, CrewCommentDelete } from "@/components/crew-post-actions";
import { getCachedUser } from "@/lib/supabase/auth";
import type { DictKey } from "@/lib/i18n/dictionaries/en";
import { Back, Chip, Hint, Panel } from "@/components/rox/ui";

/**
 * 게시글 상세 — 시안 crew.tsx CrewBoard(상세) 그대로 (PORT_PLAN §3-e):
 * Back · Panel[ Chip 말머리 · h1.rx-article-title · p.rx-muted 작성자·날짜 · article.rx-prose · Go 편집 · 좋아요 ]
 * · Panel "댓글 N"[ .rx-actions(Input · Button) · .rx-note-row ].
 */
export default async function CrewPostPage({ params }: { params: Promise<{ slug: string; postId: string }> }) {
  const { slug, postId } = await params;
  const [crew, user, { t, tag, tz }] = await Promise.all([getCrew(slug), getCachedUser(), getT()]);
  if (!crew) notFound();

  const supabase = await createClient();
  const { data } = await supabase.rpc("crew_post_detail", { p_post: postId });
  const post = (data as CrewPostDetail[] | null)?.[0];
  if (!post) notFound();

  const canInteract = isActiveMember(crew);
  const isStaff = crew.my_role === "owner" || crew.my_role === "coach";
  const canEditPost = !!user && (post.author_id === user.id || isStaff);

  return (
    <>
      <Back href={`/crews/${slug}/board`} label={t("crew.board")} />
      <Panel>
        <div className="rx-actions" style={{ marginTop: 0 }}>
          <Chip tone={post.category === "notice" ? "yellow" : "neutral"}>{t(`crew.cat.${post.category}` as DictKey)}</Chip>
          {post.pinned && <Chip tone="yellow">📌</Chip>}
          {post.members_only && <Chip tone="blue">{t("crew.fullOnly")}</Chip>}
        </div>
        <h1 className="rx-article-title">{post.title}</h1>
        <p className="rx-muted">
          <Link href={`/u/${post.author_id}`}>{post.author_name}</Link> · {formatDate(post.created_at, tag, tz)}
        </p>
        {post.body && (
          <article className="rx-prose" style={{ whiteSpace: "pre-line" }}>
            {post.body}
          </article>
        )}
        <div className="rx-actions">
          {canEditPost && <CrewPostActions slug={slug} postId={post.id} />}
          <CrewLikeButton postId={post.id} initialLiked={post.liked_by_me} initialCount={post.like_count} canLike={canInteract} />
        </div>
      </Panel>

      <Panel title={`${t("crew.comments")} ${post.comments.length}`}>
        {canInteract ? <CrewCommentForm postId={post.id} /> : <Hint>{t("crew.memberOnly")}</Hint>}
        {post.comments.map((c) => (
          <p className="rx-note-row" key={c.id}>
            <b>
              <Link href={`/u/${c.author_id}`}>{c.author_name}</Link> · {formatDate(c.created_at, tag, tz)}
            </b>
            {!!user && (c.author_id === user.id || isStaff) && (
              <>
                {" "}
                <CrewCommentDelete commentId={c.id} />
              </>
            )}
            <br />
            {c.body}
          </p>
        ))}
      </Panel>
    </>
  );
}
