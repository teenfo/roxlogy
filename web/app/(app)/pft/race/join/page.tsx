import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { PftRacePick, type JoinableRace } from "@/components/pft-race-pick";
import { ProfileRequired, missingForRace } from "@/components/profile-required";
import { getCachedUser } from "@/lib/supabase/auth";
import { Back, PageHead } from "@/components/rox/ui";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("pft.race.join") };
}

/**
 * 레이스 참가 — 시안 racing.tsx PFT(join): Back · PageHead · Panel "참가 코드"(Field·Hint).
 * 참가 가능한 레이스를 먼저 보여 주고 고르게 한다. 코드 입력은 보조 수단.
 */
export default async function PftRaceJoinPage() {
  const { t, tag, tz } = await getT();
  const supabase = await createClient();
  // supabase-js 는 실패해도 throw 하지 않는다 — 빈 목록으로 보이면 "레이스가 없다"로 읽힌다
  const user = await getCachedUser();
  const [{ data, error }, { data: me }] = await Promise.all([
    supabase.rpc("pft_race_joinable"),
    supabase.from("profiles").select("birth_year, gender").eq("id", user!.id).maybeSingle(),
  ]);
  const races = (Array.isArray(data) ? (data as JoinableRace[]) : []) ?? [];
  // 배지·순위가 나이·성별로 갈린다 — 비어 있으면 참가를 막고 프로필로 보낸다
  const missing = missingForRace(me as { birth_year: number | null; gender: string | null } | null);

  return (
    <>
      <Back href="/pft" label={t("pft.title")} />
      <PageHead title={t("pft.race.join")} description={t("pft.race.joinPageDesc")} />
      {error && (
        <p role="alert" className="rx-error">
          {t("pft.race.listError")}
        </p>
      )}
      <ProfileRequired missing={missing} />
      <PftRacePick races={races} locale={tag} tz={tz} blocked={missing.length > 0} />
    </>
  );
}
