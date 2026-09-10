import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { PftForm } from "@/components/pft-form";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("pft.add") };
}

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
    me?.birth_year != null
      ? new Date().getFullYear() - Number(me.birth_year)
      : null;
  const gender = ["male", "female", "other"].includes(String(me?.gender))
    ? String(me!.gender)
    : null;

  return (
    <main>
      <Link href="/pft" className="text-[13px] text-muted hover:text-foreground">
        ← {t("pft.title")}
      </Link>
      <h1 className="mt-2 text-[26px] font-extrabold">{t("pft.add")}</h1>
      <p className="mt-1 text-sm text-muted">
        {t("pft.addDesc")}{" "}
        <Link href="/pft/measure" className="text-accent hover:underline">
          {t("pft.mStartCta")} →
        </Link>
      </p>
      <div className="mt-5">
        <PftForm defaultAge={age} defaultGender={gender} />
      </div>
    </main>
  );
}
