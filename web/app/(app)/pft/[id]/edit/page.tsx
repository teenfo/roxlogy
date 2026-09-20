import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { PftForm } from "@/components/pft-form";
import type { PftResult } from "@/lib/pft";
import { Back, PageHead } from "@/components/rox/ui";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("pft.editTitle") };
}

/** PFT 기록 수정 — 시안 racing.tsx PFT(edit): Back · PageHead · form.rx-form-layout(PftForm) */
export default async function PftEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [{ t }, user] = await Promise.all([getT(), getCachedUser()]);
  const supabase = await createClient();

  // 본인 기록만 수정 — shared 행은 RLS 로 전체 공개라 user_id 필터가 필수
  const { data } = await supabase
    .from("pft_results")
    .select(
      "id, tested_on, total_ms, run_ms, burpee_ms, lunge_ms, row_ms, pushup_ms, wallball_ms, age, gender, scaled, badge, location, note, shared",
    )
    .eq("id", id)
    .eq("user_id", user!.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) notFound();

  return (
    <>
      <Back href="/pft" label={t("pft.title")} />
      <PageHead title={t("pft.editTitle")} description={t("pft.addDesc")} />
      <PftForm initial={data as PftResult} defaultAge={null} defaultGender={null} />
    </>
  );
}
