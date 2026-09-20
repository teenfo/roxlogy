import { notFound, redirect } from "next/navigation";
import { getCrew, isActiveMember } from "@/lib/crew";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { CrewPostForm } from "@/components/crew-post-form";
import { Back, PageHead } from "@/components/rox/ui";

/** 글쓰기 — 시안 CrewBoard(new): Back · PageHead("크루 글쓰기") · form Panel(CrewPostForm). */
export default async function CrewNewPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [crew, user, { t }] = await Promise.all([getCrew(slug), getCachedUser(), getT()]);
  if (!crew) notFound();
  if (!user) redirect(`/login?next=/crews/${slug}/board/new`);
  if (!isActiveMember(crew)) redirect(`/crews/${slug}/board`);

  return (
    <>
      <Back href={`/crews/${slug}/board`} label={t("crew.board")} />
      <PageHead title={t("crew.writePost")} description={t("crew.writePostDesc")} />
      <CrewPostForm slug={slug} crewId={crew.id} isStaff={crew.my_role === "owner" || crew.my_role === "coach"} />
    </>
  );
}
