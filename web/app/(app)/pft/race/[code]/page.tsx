import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { PftRaceRunner } from "@/components/pft-race-runner";
import type { BoardData, MyEntry } from "@/lib/pft-race";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { t } = await getT();
  return { title: `${t("pft.race.title")} ${code.toUpperCase()}` };
}

/** 참가자 화면 — 내 엔트리 진행 + (운영진이면) 레이스 관리 */
export default async function PftRaceRunPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const user = await getCachedUser();
  const supabase = await createClient();
  const { data: boardRaw } = await supabase.rpc("pft_race_board", { p_code: code });
  const board = (boardRaw as BoardData | null) ?? null;
  if (!board) notFound();

  const [{ data: mine }, { data: manage }, { data: me }] = await Promise.all([
    supabase.rpc("pft_race_my_entry", { p_race: board.race.id }),
    supabase.rpc("pft_race_can_manage", { p_race: board.race.id }),
    supabase.from("profiles").select("birth_year").eq("id", user!.id).maybeSingle(),
  ]);
  const age = me?.birth_year != null ? new Date().getFullYear() - Number(me.birth_year) : null;

  return (
    <main className="mx-auto w-full max-w-lg">
      <PftRaceRunner
        race={board.race}
        initialEntry={(mine as MyEntry | null) ?? null}
        serverNow={board.server_now}
        canManage={manage === true}
        defaultAge={age}
      />
    </main>
  );
}
