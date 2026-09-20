import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { PftMeasure } from "@/components/pft-measure";
import { PFT_STATIONS } from "@/lib/pft";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("pft.mTitle") };
}

/** PFT 측정 — 화면은 PftMeasure → PftMeasureView(시안 .rx-stopwatch) 가 그린다 */
export default async function PftMeasurePage() {
  const user = await getCachedUser();
  const supabase = await createClient();
  // 배지 판정 근거(프로필)와 내 최고 기록(예상 완주·구간 PB)은 서로 독립 — 한 번에 읽는다
  const [{ data: me }, { data: bestRow }] = await Promise.all([
    supabase.from("profiles").select("birth_year, gender").eq("id", user!.id).maybeSingle(),
    supabase
      .from("pft_results")
      .select("total_ms, run_ms, burpee_ms, lunge_ms, row_ms, pushup_ms, wallball_ms")
      .eq("user_id", user!.id)
      .is("deleted_at", null)
      .order("total_ms", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const age =
    me?.birth_year != null ? new Date().getFullYear() - Number(me.birth_year) : null;
  const gender = ["male", "female", "other"].includes(String(me?.gender))
    ? String(me!.gender)
    : null;

  // 없으면 컴포넌트가 균등 배분으로 떨어진다.
  const best =
    bestRow && PFT_STATIONS.every((st) => bestRow[st.col] != null)
      ? {
          totalMs: bestRow.total_ms as number,
          splits: PFT_STATIONS.map((st) => bestRow[st.col] as number),
        }
      : null;

  return <PftMeasure defaultAge={age} defaultGender={gender} best={best} />;
}
