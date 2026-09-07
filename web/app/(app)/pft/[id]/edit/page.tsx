import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { PftForm } from "@/components/pft-form";
import type { PftResult } from "@/lib/pft";

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
    <main>
      <Link href="/pft" className="text-sm text-muted hover:text-foreground">
        ← {t("pft.title")}
      </Link>
      <h1 className="mt-3 text-2xl font-bold">{t("pft.editTitle")}</h1>
      <div className="mt-5">
        <PftForm
          initial={data as PftResult}
          defaultAge={null}
          defaultGender={null}
        />
      </div>
    </main>
  );
}
