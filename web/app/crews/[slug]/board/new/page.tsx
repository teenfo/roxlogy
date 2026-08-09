import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCrew, isActiveMember } from "@/lib/crew";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { CrewPostForm } from "@/components/crew-post-form";

export default async function CrewNewPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [crew, user, { t }] = await Promise.all([
    getCrew(slug),
    getCachedUser(),
    getT(),
  ]);
  if (!crew) notFound();
  if (!user) redirect(`/login?next=/crews/${slug}/board/new`);
  if (!isActiveMember(crew)) redirect(`/crews/${slug}/board`);

  return (
    <main>
      <Link
        href={`/crews/${slug}/board`}
        className="text-xs text-muted hover:text-accent"
      >
        ← {t("crew.board")}
      </Link>
      <h1 className="mt-2 text-2xl font-bold">{t("crew.newPost")}</h1>
      <CrewPostForm
        slug={slug}
        crewId={crew.id}
        isStaff={crew.my_role === "owner" || crew.my_role === "coach"}
      />
    </main>
  );
}
