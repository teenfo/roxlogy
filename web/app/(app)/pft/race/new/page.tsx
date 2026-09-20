import { createClient } from "@/lib/supabase/server";
import { getCachedProfile, getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { PftRaceCreateForm } from "@/components/pft-race-forms";
import { Back, Empty, Go, PageHead } from "@/components/rox/ui";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("pft.race.create") };
}

/**
 * 레이스 만들기 — 시안 racing.tsx PFT(new): Back · PageHead · Panel "레이스 정보"(Field·Hint).
 * 전체 관리자 또는 내가 운영진인 크루.
 */
export default async function PftRaceNewPage() {
  const [{ t }, user, profile] = await Promise.all([getT(), getCachedUser(), getCachedProfile()]);
  const supabase = await createClient();
  const { data: staffRows } = await supabase
    .from("crew_members")
    .select("crews ( slug, name )")
    .eq("user_id", user!.id)
    .eq("status", "active")
    .in("role", ["owner", "coach"]);
  type Row = { crews: { slug: string; name: string } | { slug: string; name: string }[] | null };
  const crews = ((staffRows ?? []) as unknown as Row[])
    .map((r) => (Array.isArray(r.crews) ? r.crews[0] : r.crews))
    .filter((c): c is { slug: string; name: string } => !!c);
  const allowed = !!profile?.is_admin || crews.length > 0;

  return (
    <>
      <Back href="/pft" label={t("pft.title")} />
      <PageHead title={t("pft.race.create")} description={t("pft.race.createDesc")} />
      {allowed ? (
        <PftRaceCreateForm crews={crews} />
      ) : (
        <Empty
          title={t("pft.race.err.not_allowed")}
          description={t("pft.race.createDesc")}
          action={<Go href="/pft/race/join">{t("pft.race.join")}</Go>}
        />
      )}
    </>
  );
}
