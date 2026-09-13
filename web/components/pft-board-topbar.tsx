"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useI18n } from "@/components/i18n-provider";
import { fmtWallClock } from "@/lib/pft-race";

/** Esc 로 빠져나가는 경우까지 포함해 전체화면 상태 변화를 알린다. */
function subscribeFullscreen(onChange: () => void) {
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
}

/** 공개 보드 상단 바 — 로고 + 전체화면 + LIVE 점(펄스) + 현재 시각(1초). 종료된 레이스는 "종료". */
export function PftBoardTopBar({ closed }: { closed: boolean }) {
  const { t } = useI18n();
  const [clock, setClock] = useState<string | null>(null);
  // 전체화면 상태·지원 여부는 브라우저만 아는 값이라 useSyncExternalStore 로 읽는다.
  // (효과 안에서 setState 하면 렌더가 한 번 더 돈다 — react-hooks/set-state-in-effect)
  // 서버 스냅샷은 false: 아이폰 사파리처럼 지원하지 않는 곳에서는 버튼을 아예 감춘다.
  const canFull = useSyncExternalStore(
    subscribeFullscreen,
    () => document.fullscreenEnabled === true,
    () => false,
  );
  const isFull = useSyncExternalStore(
    subscribeFullscreen,
    () => document.fullscreenElement != null,
    () => false,
  );

  useEffect(() => {
    const tick = () => setClock(fmtWallClock(new Date()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  const toggleFull = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // 사용자 제스처가 없거나 브라우저가 거부한 경우 — 화면은 그대로 둔다
    }
  };
  return (
    <div className="flex h-14 items-center justify-between border-b border-line-soft px-4 md:px-7">
      <Link href="/" className="flex items-center gap-2.5 text-base font-extrabold tracking-[0.08em]">
        <Image src="/roxlogy-mark.svg" alt="" width={28} height={28} priority />
        ROXLOGY
      </Link>
      <div className="flex items-center gap-3.5 text-[13px] text-muted">
        {canFull && (
          <button
            type="button"
            onClick={toggleFull}
            aria-pressed={isFull}
            title={t(isFull ? "pft.race.exitFullscreen" : "pft.race.fullscreen")}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-control px-2.5 text-[13px] font-semibold text-foreground transition-colors hover:border-muted/60"
          >
            <span aria-hidden className="text-[15px] leading-none">
              {isFull ? "⤡" : "⛶"}
            </span>
            <span className="hidden sm:inline">
              {t(isFull ? "pft.race.exitFullscreen" : "pft.race.fullscreen")}
            </span>
          </button>
        )}
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
