import { notFound } from "next/navigation";
import { getCrew } from "@/lib/crew";
import { getCachedUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import {
  CrewDeleteButton,
  CrewImageUpload,
  CrewInfoForm,
  CrewMemberManage,
  type ManageMember,
} from "@/components/crew-manage";
import {
  CrewProgramAttach,
  type AttachedProgram,
  type PickableProgram,
} from "@/components/crew-program-attach";
import {
  CrewDuesLinksManage,
  type DuesLink,
} from "@/components/crew-dues-links";

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
  const [
    { data: row },
    { data: roster },
    { data: attachedRows },
    { data: progRows },
    { data: duesRows },
  ] = await Promise.all([
      supabase
        .from("crews")
        .select(
          "id, slug, name, tagline, description, location, links, logo_url, cover_url, join_policy, is_public",
        )
        .eq("slug", slug)
        .maybeSingle(),
      supabase.rpc("crew_manage_roster", { p_slug: slug }),
      supabase
        .from("crew_program_enrollments")
        .select("program_id, start_date, end_date, programs ( title )")
        .eq("crew_id", crew.id)
        .order("start_date"),
      supabase.from("programs").select("id, title").order("created_at"),
      supabase
        .from("crew_dues_links")
        .select("id, label, url, audience")
        .eq("crew_id", crew.id)
        .order("sort_order")
        .order("created_at"),
    ]);
  if (!row) notFound();
  const members = (roster ?? []) as ManageMember[];
  type AttachedRow = {
    program_id: string;
    start_date: string;
    end_date: string | null;
    programs: { title: string } | null;
  };
  const attached: AttachedProgram[] = (
    (attachedRows ?? []) as unknown as AttachedRow[]
  ).map((a) => ({
    program_id: a.program_id,
    start_date: a.start_date,
    end_date: a.end_date,
    title: a.programs?.title ?? "—",
  }));
  const pickable = (progRows ?? []) as PickableProgram[];

  return (
    <main className="flex flex-col gap-10">
      <section>
        <h2 className="text-lg font-bold">{t("crew.logoTitle")}</h2>
        <div className="mt-3">
          <CrewImageUpload crewId={crew.id} url={row.logo_url} kind="logo" />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-bold">{t("crew.coverTitle")}</h2>
        <div className="mt-3">
          <CrewImageUpload crewId={crew.id} url={row.cover_url} kind="cover" />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-bold">{t("crew.manageInfo")}</h2>
        <div className="mt-3 max-w-lg">
          <CrewInfoForm crew={row} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-bold">{t("crew.duesTitle")}</h2>
        <div className="mt-3 max-w-lg">
          <CrewDuesLinksManage
            crewId={crew.id}
            items={(duesRows ?? []) as DuesLink[]}
          />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-bold">{t("crew.progAttach")}</h2>
        <div className="mt-3">
          <CrewProgramAttach
            crewId={crew.id}
            attached={attached}
            programs={pickable}
          />
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
