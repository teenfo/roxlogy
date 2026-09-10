import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { PftMeasure } from "@/components/pft-measure";
import { PFT_STATIONS } from "@/lib/pft";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("pft.mTitle") };
}

export default async function PftMeasurePage() {
  const user = await getCachedUser();
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

  // 내 최고 기록의 구간 스플릿 — 측정 중 "예상 완주"와 구간별 PB 비교에 쓴다.
  // 없으면 컴포넌트가 균등 배분으로 떨어진다.
  const { data: bestRow } = await supabase
    .from("pft_results")
    .select(
      "total_ms, run_ms, burpee_ms, lunge_ms, row_ms, pushup_ms, wallball_ms",
    )
    .eq("user_id", user!.id)
    .is("deleted_at", null)
    .order("total_ms", { ascending: true })
    .limit(1)
    .maybeSingle();

  const best =
    bestRow &&
    PFT_STATIONS.every((st) => bestRow[st.col] != null)
      ? {
          totalMs: bestRow.total_ms as number,
          splits: PFT_STATIONS.map((st) => bestRow[st.col] as number),
        }
      : null;

  return (
    <main>
      <PftMeasure defaultAge={age} defaultGender={gender} best={best} />
    </main>
  );
}
