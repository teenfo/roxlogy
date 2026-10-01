import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCrew, isActiveMember, type CrewPostDetail } from "@/lib/crew";
import { getT } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { CrewLikeButton } from "@/components/crew-like-button";
import { CrewCommentForm } from "@/components/crew-comment-form";
import {
  CrewPostActions,
  CrewCommentDelete,
} from "@/components/crew-post-actions";
import { getCachedUser } from "@/lib/supabase/auth";
import type { DictKey } from "@/lib/i18n/dictionaries/en";
import { postImageUrls } from "@/lib/crew-media";
import { CrewPostBody, imagesInBody } from "@/components/crew-post-body";

export default async function CrewPostPage({
  params,
}: {
  params: Promise<{ slug: string; postId: string }>;
}) {
  const { slug, postId } = await params;
  const [crew, user, { t, tag, tz }] = await Promise.all([
    getCrew(slug),
    getCachedUser(),
    getT(),
  ]);
  if (!crew) notFound();

  const supabase = await createClient();
  const { data } = await supabase.rpc("crew_post_detail", { p_post: postId });
  const post = (data as CrewPostDetail[] | null)?.[0];
  if (!post) notFound();

  const canInteract = isActiveMember(crew);
  const isStaff = crew.my_role === "owner" || crew.my_role === "coach";
  const canEditPost = !!user && (post.author_id === user.id || isStaff);
  // 본문에 이미 마크다운으로 넣은 그림은 글 끝 모음에서 뺀다(두 번 보이지 않게).
  // image_urls 는 목록 썸네일로 계속 쓴다.
  const inBody = imagesInBody(post.body);
  const images = postImageUrls(post.image_urls).filter((u) => !inBody.has(u));

  return (
    <main>
      <Link
        href={`/crews/${slug}/board`}
        className="text-xs text-muted hover:text-accent"
      >
        ← {t("crew.board")}
      </Link>

      <article className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-muted/40 px-2 py-0.5 text-[10px] text-muted">
            {t(`crew.cat.${post.category}` as DictKey)}
          </span>
          {post.pinned && (
            <span className="text-[10px] font-bold text-accent">PIN</span>
          )}
          {post.members_only && (
            <span className="rounded-full bg-track/15 px-2 py-0.5 text-[10px] font-bold text-track">
              {t("crew.fullOnly")}
            </span>
          )}
          {canEditPost && <CrewPostActions slug={slug} postId={post.id} />}
        </div>
        <h1 className="mt-2 text-2xl font-bold leading-snug">{post.title}</h1>
        <p className="mt-2 flex flex-wrap gap-x-3 text-xs text-muted">
          <Link href={`/u/${post.author_id}`} className="hover:text-accent">
            {post.author_name}
          </Link>
          <span>{formatDate(post.created_at, tag, tz)}</span>
        </p>

        {/* 본문 — 마크다운(raw HTML 은 그리지 않는다). components/crew-post-body.tsx */}
        {post.body && (
          <div className="mt-6">
            <CrewPostBody body={post.body} />
          </div>
        )}

        {/* 첨부 이미지 — 배열 순서대로. GIF 애니메이션이 살아 있어야 해서 next/image 대신 <img>.
            주소는 https 링크만(lib/crew-media.ts), 리퍼러는 보내지 않는다 */}
        {images.length > 0 && (
          <div className="mt-6 flex flex-col gap-3">
            {images.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`${i}-${src}`}
                src={src}
                alt={images.length > 1 ? `${post.title} ${i + 1}` : post.title}
                loading={i === 0 ? "eager" : "lazy"}
                decoding="async"
                referrerPolicy="no-referrer"
                className="h-auto w-full rounded-md border border-surface bg-card"
              />
            ))}
          </div>
        )}

        <div className="mt-6 flex items-center gap-3 border-t border-surface pt-4">
          <CrewLikeButton
            postId={post.id}
            initialLiked={post.liked_by_me}
            initialCount={post.like_count}
            canLike={canInteract}
          />
        </div>
      </article>

      <section className="mt-8">
        <h2 className="text-sm font-bold">
          {t("crew.comments")}{" "}
          <span className="text-muted">{post.comments.length}</span>
        </h2>

        {!!post.comments.length && (
          <ul className="mt-3 flex flex-col gap-px overflow-hidden rounded-md bg-muted/20">
            {post.comments.map((c) => (
              <li key={c.id} className="bg-card px-4 py-3">
                <div className="flex items-baseline gap-2">
                  <Link
                    href={`/u/${c.author_id}`}
                    className="text-xs font-semibold hover:text-accent"
                  >
                    {c.author_name}
                  </Link>
                  <span className="text-xs text-muted">
                    {formatDate(c.created_at, tag, tz)}
                  </span>
                  {!!user && (c.author_id === user.id || isStaff) && (
                    <CrewCommentDelete commentId={c.id} />
                  )}
                </div>
                <p className="mt-1 whitespace-pre-line text-sm">{c.body}</p>
              </li>
            ))}
          </ul>
        )}

        {canInteract ? (
          <CrewCommentForm postId={post.id} />
        ) : (
          <p className="mt-4 text-center text-xs text-muted">
            {t("crew.memberOnly")}
          </p>
        )}
      </section>
    </main>
  );
}
