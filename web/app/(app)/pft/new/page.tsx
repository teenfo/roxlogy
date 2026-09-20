import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { PftForm } from "@/components/pft-form";
import { Back, PageHead } from "@/components/rox/ui";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("pft.add") };
}

/** PFT 기록 추가 — 시안 racing.tsx PFT(new): Back · PageHead · form.rx-form-layout(PftForm) */
export default async function PftNewPage() {
  const [{ t }, user] = await Promise.all([getT(), getCachedUser()]);
  const supabase = await createClient();
  // 나이·성별 기본값은 프로필에서 — 배지 판정 근거라 저장 시점 값으로 굳는다
  const { data: me } = await supabase
    .from("profiles")
    .select("birth_year, gender")
    .eq("id", user!.id)
    .maybeSingle();

  const age =
    me?.birth_year != null ? new Date().getFullYear() - Number(me.birth_year) : null;
  const gender = ["male", "female", "other"].includes(String(me?.gender))
    ? String(me!.gender)
    : null;

  return (
    <>
      <Back href="/pft" label={t("pft.title")} />
      <PageHead title={t("pft.add")} description={t("pft.addDesc")} />
      <PftForm defaultAge={age} defaultGender={gender} />
    </>
  );
}
