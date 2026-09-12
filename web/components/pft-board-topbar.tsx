"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { fmtWallClock } from "@/lib/pft-race";

/** 공개 보드 상단 바 — 로고 + LIVE 점(펄스) + 현재 시각(1초). 종료된 레이스는 "종료". */
export function PftBoardTopBar({ closed }: { closed: boolean }) {
  const { t } = useI18n();
  const [clock, setClock] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setClock(fmtWallClock(new Date()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="flex h-14 items-center justify-between border-b border-line-soft px-4 md:px-7">
      <Link href="/" className="flex items-center gap-2.5 text-base font-extrabold tracking-[0.08em]">
        <Image src="/roxlogy-mark.svg" alt="" width={28} height={28} priority />
        ROXLOGY
      </Link>
      <div className="flex items-center gap-3.5 text-[13px] text-muted">
        {closed ? (
          <span className="font-extrabold tracking-[0.06em]">{t("pft.race.ended")}</span>
        ) : (
          <span className="inline-flex items-center gap-1.5 font-extrabold tracking-[0.06em] text-danger">
            <span aria-hidden className="h-2 w-2 rounded-full bg-danger motion-safe:animate-[livepulse_1.2s_ease-in-out_infinite]" />
            LIVE
          </span>
        )}
        <span>{t("pft.race.liveTag")}</span>
        <span className="tabular hidden min-w-[64px] md:inline" aria-live="off">
          {clock ?? ""}
        </span>
      </div>
    </div>
  );
}
