"use client";

import { useState } from "react";
import { useI18n } from "@/components/i18n-provider";

/** 캘린더 구독 URL 복사 — 구글/애플 캘린더의 "URL 로 추가"에 붙여넣으면
 *  프로그램 수정이 자동 반영된다(갱신 주기는 캘린더 서비스가 결정). */
export function ProgramCalendarSubscribe({
  programId,
  token,
}: {
  programId: string;
  token: string;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = `${window.location.origin}/programs/${programId}/calendar.ics?token=${token}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt(t("programs.subscribeCopy"), url);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-md bg-surface px-2.5 py-1 text-xs font-semibold text-foreground hover:text-accent"
    >
      {copied ? `✓ ${t("programs.copied")}` : `🔗 ${t("programs.subscribeCopy")}`}
    </button>
  );
}
