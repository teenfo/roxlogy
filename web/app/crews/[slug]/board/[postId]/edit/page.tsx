import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCrew } from "@/lib/crew";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { CrewPostForm } from "@/components/crew-post-form";
import type { PostCategory } from "@/lib/crew-types";
import { Back, PageHead } from "@/components/rox/ui";

/** 글 수정 — 작성자 본인 또는 운영진. crew_posts_update_own RLS 로도 보호된다.
 *  시안 CrewBoard(edit) 과 같은 모양: Back · PageHead · form Panel. */
export default async function CrewEditPostPage({ params }: { params: Promise<{ slug: string; postId: string }> }) {
  const { slug, postId } = await params;
  const [crew, user, { t }] = await Promise.all([getCrew(slug), getCachedUser(), getT()]);
  if (!crew) notFound();
  if (!user) redirect(`/login?next=/crews/${slug}/board/${postId}/edit`);

  const supabase = await createClient();
  const { data: post } = await supabase.from("crew_posts").select("id, author_id, category, title, body, members_only").eq("id", postId).maybeSingle();
  if (!post) notFound();

  const isStaff = crew.my_role === "owner" || crew.my_role === "coach";
  if (post.author_id !== user.id && !isStaff) redirect(`/crews/${slug}/board/${postId}`);

  return (
    <>
      <Back href={`/crews/${slug}/board/${postId}`} label={t("crew.board")} />
      <PageHead title={t("crew.editPost")} description={t("crew.writePostDesc")} />
      <CrewPostForm
        slug={slug}
        crewId={crew.id}
        isStaff={isStaff}
        edit={{
          id: post.id,
          category: post.category as PostCategory,
          title: post.title,
          body: post.body,
          members_only: post.members_only,
        }}
      />
    </>
  );
}
