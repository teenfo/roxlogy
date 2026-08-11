import { notFound } from "next/navigation";
import { getCrew } from "@/lib/crew";
import { getCachedUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import {
  CrewDeleteButton,
  CrewInfoForm,
  CrewMemberManage,
  type ManageMember,
} from "@/components/crew-manage";

export default async function CrewManagePage({
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
  if (!crew || !user) notFound();
  const myRole = crew.my_role;
  if (myRole !== "owner" && myRole !== "coach") notFound();

  const supabase = await createClient();
  // 정보 폼 초기값 — crew_overview 에 없는 join_policy/is_public 은 테이블에서 직접 (멤버 RLS 허용)
  const [{ data: row }, { data: roster }] = await Promise.all([
    supabase
      .from("crews")
      .select("id, slug, name, tagline, description, location, join_policy, is_public")
      .eq("slug", slug)
      .maybeSingle(),
    supabase.rpc("crew_manage_roster", { p_slug: slug }),
  ]);
  if (!row) notFound();
  const members = (roster ?? []) as ManageMember[];

  return (
    <main className="flex flex-col gap-10">
      <section>
        <h2 className="text-lg font-bold">{t("crew.manageInfo")}</h2>
        <div className="mt-3 max-w-lg">
          <CrewInfoForm crew={row} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-bold">{t("crew.manageMembers")}</h2>
        <div className="mt-3">
          <CrewMemberManage
            slug={slug}
            crewId={crew.id}
            myRole={myRole}
            myUserId={user.id}
            members={members}
          />
        </div>
      </section>

      {myRole === "owner" && (
        <section>
          <h2 className="text-lg font-bold text-red-400">{t("crew.dangerZone")}</h2>
          <p className="mt-1 text-sm text-muted">{t("crew.deleteCrewDesc")}</p>
          <div className="mt-3">
            <CrewDeleteButton crewId={crew.id} />
          </div>
        </section>
      )}
    </main>
  );
}
