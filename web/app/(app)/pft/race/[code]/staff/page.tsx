import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { PftRaceStaff } from "@/components/pft-race-staff";
import type { BoardData } from "@/lib/pft-race";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { t } = await getT();
  return { title: `${t("pft.race.staff")} ${code.toUpperCase()}` };
}

/** 스태프 타이밍 — 운영진(전체 관리자·크루 운영진)만. 아니면 참가자 화면으로 보낸다. */
export default async function PftRaceStaffPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const supabase = await createClient();
  const { data: boardRaw } = await supabase.rpc("pft_race_board", { p_code: code });
  const board = (boardRaw as BoardData | null) ?? null;
  if (!board) notFound();
  const { data: manage } = await supabase.rpc("pft_race_can_manage", { p_race: board.race.id });
  if (manage !== true) redirect(`/pft/race/${board.race.code}`);

  return (
    <main className="mx-auto w-full max-w-5xl">
      <PftRaceStaff initial={board} />
    </main>
  );
}
