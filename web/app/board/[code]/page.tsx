import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { PftRaceBoard } from "@/components/pft-race-board";
import type { BoardData } from "@/lib/pft-race";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("pft_race_board", { p_code: code });
  const b = data as BoardData | null;
  return { title: b ? `${b.race.title} · ${b.race.code}` : "Roxlogy", robots: { index: false } };
}

/** 공개 레이스 보드 — 로그인 없이 코드로 연다. 현장 TV·프로젝터용. */
export default async function BoardPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { t } = await getT();
  const supabase = await createClient();
  const { data } = await supabase.rpc("pft_race_board", { p_code: code });
  const board = data as BoardData | null;
  if (!board) notFound();

  return (
    <div className="min-h-dvh bg-page text-foreground">
      <div className="flex items-center justify-between border-b border-line-soft px-4 py-2.5 md:px-8">
        <Link href="/" className="flex items-center gap-2 text-sm font-extrabold tracking-tight">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[11px] font-black text-background">R</span>
          ROXLOGY
        </Link>
        <span className="text-xs text-muted">{t("pft.race.liveTag")}</span>
      </div>
      <PftRaceBoard initial={board} />
    </div>
  );
}
