import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PftRaceBoard } from "@/components/pft-race-board";
import type { BoardData } from "@/lib/pft-race";

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
    // 라이브보드는 현장 모니터용 독립 다크 화면이다 — 앱이 밝아져도 여기는 어둡다
    // (스펙 §15: "일반 화면의 다크 모드 전환 기능을 의미하지 않습니다").
    <div className="theme-dark flex min-h-dvh flex-col bg-page text-foreground">
      {/* 상단 바는 보드 컴포넌트가 그린다 — 종료 표시가 Realtime 으로 같이 바뀌어야 한다 */}
      <PftRaceBoard initial={board} meId={auth.user?.id ?? null} />
    </div>
  );
}
