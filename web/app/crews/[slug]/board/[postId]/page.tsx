import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCrew, isActiveMember, type CrewPostDetail } from "@/lib/crew";
import { getT } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { CrewLikeButton } from "@/components/crew-like-button";
import { CrewCommentForm } from "@/components/crew-comment-form";
import type { DictKey } from "@/lib/i18n/dictionaries/en";

export default async function CrewPostPage({
  params,
}: {
  params: Promise<{ slug: string; postId: string }>;
}) {
  const { slug, postId } = await params;
  const [crew, { t, tag, tz }] = await Promise.all([getCrew(slug), getT()]);
  if (!crew) notFound();

  const supabase = await createClient();
  const { data } = await supabase.rpc("crew_post_detail", { p_post: postId });
  const post = (data as CrewPostDetail[] | null)?.[0];
  if (!post) notFound();

  const canInteract = isActiveMember(crew);

  return (
    <main>
      <Link
        href={`/crews/${slug}/board`}
        className="text-xs text-muted hover:text-accent"
      >
        ← {t("crew.board")}
      </Link>

      <article className="mt-3">
        <div className="flex items-center gap-2">
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
        </div>
        <h1 className="mt-2 text-2xl font-bold leading-snug">{post.title}</h1>
        <p className="mt-2 flex flex-wrap gap-x-3 text-xs text-muted">
          <Link href={`/u/${post.author_id}`} className="hover:text-accent">
            {post.author_name}
          </Link>
          <span>{formatDate(post.created_at, tag, tz)}</span>
        </p>

        {post.body && (
          <div className="mt-6 whitespace-pre-line text-sm leading-relaxed text-foreground/90">
            {post.body}
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
              <li key={c.id} className="bg-surface px-4 py-3">
                <div className="flex items-baseline gap-2">
                  <Link
                    href={`/u/${c.author_id}`}
                    className="text-xs font-semibold hover:text-accent"
                  >
                    {c.author_name}
                  </Link>
                  <span className="text-[11px] text-muted">
                    {formatDate(c.created_at, tag, tz)}
                  </span>
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
