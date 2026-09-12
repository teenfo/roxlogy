import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PftRaceBoard } from "@/components/pft-race-board";
import { PftBoardTopBar } from "@/components/pft-board-topbar";
import type { BoardData } from "@/lib/pft-race";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("pft_race_board", { p_code: code });
  const b = data as BoardData | null;
  return { title: b ? `${b.race.title} · ${b.race.code}` : "Roxlogy", robots: { index: false } };
}

/** 공개 레이스 보드 — 로그인 없이 코드로 연다. 현장 TV·프로젝터용(1920×1080 기준, 세로 화면은 스택). */
export default async function BoardPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const supabase = await createClient();
  const [{ data }, { data: auth }] = await Promise.all([
    supabase.rpc("pft_race_board", { p_code: code }),
    supabase.auth.getUser(),
  ]);
  const board = data as BoardData | null;
  if (!board) notFound();

  return (
    <div className="flex min-h-dvh flex-col bg-page text-foreground">
      <PftBoardTopBar closed={board.race.status === "closed"} />
      <PftRaceBoard initial={board} meId={auth.user?.id ?? null} />
    </div>
  );
}
