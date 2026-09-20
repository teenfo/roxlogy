import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { PftRaceRunner } from "@/components/pft-race-runner";
import { ProfileRequired, missingForRace } from "@/components/profile-required";
import type { BoardData, MyEntry } from "@/lib/pft-race";
import { PFT_STATIONS } from "@/lib/pft";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { t } = await getT();
  return { title: `${t("pft.race.title")} ${code.toUpperCase()}` };
}

/**
 * 참가자 화면 — 시안 pft-race.tsx PftRaceOverview(레이스 현황·나의 참가 상태) + .rx-stopwatch.
 * 내 엔트리 진행 + (운영진이면) 레이스 관리. 화면은 PftRaceRunner 가 그린다.
 */
export default async function PftRaceRunPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const user = await getCachedUser();
  const supabase = await createClient();
  const { data: boardRaw } = await supabase.rpc("pft_race_board", { p_code: code });
  const board = (boardRaw as BoardData | null) ?? null;
  if (!board) notFound();

  const [{ data: mine }, { data: manage }, { data: me }, { data: bestRow }] = await Promise.all([
    supabase.rpc("pft_race_my_entry", { p_race: board.race.id }),
    supabase.rpc("pft_race_can_manage", { p_race: board.race.id }),
    supabase.from("profiles").select("birth_year, gender").eq("id", user!.id).maybeSingle(),
    // 내 최고 기록 — 일반 측정과 같은 "예상 완주"·구간 PB 비교에 쓴다
    supabase
      .from("pft_results")
      .select("total_ms, run_ms, burpee_ms, lunge_ms, row_ms, pushup_ms, wallball_ms")
      .eq("user_id", user!.id)
      .is("deleted_at", null)
      .order("total_ms", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  const age = me?.birth_year != null ? new Date().getFullYear() - Number(me.birth_year) : null;
  const best =
    bestRow && PFT_STATIONS.every((st) => bestRow[st.col] != null)
      ? { totalMs: bestRow.total_ms as number, splits: PFT_STATIONS.map((st) => bestRow[st.col] as number) }
      : null;

  // 배지·순위가 나이·성별로 갈린다 — 아직 참가하지 않았는데 비어 있으면 참가를 막는다
  const joinedMe = (mine as MyEntry | null) != null;
  const missing = joinedMe
    ? []
    : missingForRace(me as { birth_year: number | null; gender: string | null } | null);

  return (
    <>
      <ProfileRequired missing={missing} />
      <PftRaceRunner
        race={board.race}
        initialEntry={(mine as MyEntry | null) ?? null}
        serverNow={board.server_now}
        canManage={manage === true}
        defaultAge={age}
        best={best}
        joinBlocked={missing.length > 0}
      />
    </>
  );
}
