"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect } from "react";
import { useI18n } from "@/components/i18n-provider";

/**
 * 라우트 오류 경계 (스펙 §18).
 *
 * 지금까지 error.tsx 가 하나도 없어서, 서버 렌더가 실패하면 Next 기본 화면이
 * 그대로 나갔다 — 브랜드도 없고 한국어도 아니고 돌아갈 길도 없었다.
 *
 * 화면에는 **사유와 다음 행동만** 둔다. 프로덕션 빌드는 오류 메시지를 지우고
 * digest 만 남기므로(민감한 정보가 새지 않게 하려는 Next 의 설계), 사용자에게는
 * 그 코드만 보여 주고 원문은 콘솔로 보낸다.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    // 프로덕션에서는 message 가 비어 있고 digest 만 있다 — 서버 로그와 짝을 맞춘다
    console.error("route error", error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      <Image src="/roxlogy-appicon.svg" alt="" width={64} height={64} />
      <div>
        <h1 className="text-[30px] font-extrabold leading-[1.4] tracking-[-1px] max-[600px]:text-[25px]">
          {t("error.title")}
        </h1>
        <p className="mt-2 text-sm text-muted">{t("error.desc")}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={reset}
          className="h-[42px] rounded-[10px] bg-accent px-[17px] text-sm font-bold text-accent-foreground transition hover:brightness-95 max-md:h-12"
        >
          {t("error.retry")}
        </button>
        <Link
          href="/dashboard"
          className="flex h-[42px] items-center rounded-[10px] border border-line-strong bg-card px-[17px] text-sm font-semibold transition hover:bg-card-hover max-md:h-12"
        >
          {t("nav.dashboard")}
        </Link>
      </div>
      {error.digest && (
        <p className="text-xs text-muted-3">
          {t("error.digest")} {error.digest}
        </p>
      )}
    </main>
  );
}
