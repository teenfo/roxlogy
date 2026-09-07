import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { PftMeasure } from "@/components/pft-measure";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("pft.mTitle") };
}

export default async function PftMeasurePage() {
  const [{ t }, user] = await Promise.all([getT(), getCachedUser()]);
  const supabase = await createClient();
  // 배지 판정 근거 — 저장 시점 값으로 굳는다 (입력 폼과 같은 규칙)
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
    <main>
      <Link href="/pft" className="text-sm text-muted hover:text-foreground">
        ← {t("pft.title")}
      </Link>
      <h1 className="mt-3 text-2xl font-bold">{t("pft.mTitle")}</h1>
      <p className="mt-1 text-sm text-muted">{t("pft.mDesc")}</p>
      <div className="mt-5">
        <PftMeasure defaultAge={age} defaultGender={gender} />
      </div>
    </main>
  );
}
