"use client";

import { useState } from "react";
import { useI18n } from "@/components/i18n-provider";

/**
 * 클릭하면 값을 클립보드에 복사하는 카드. 회비 계좌처럼 손으로 옮겨 적기
 * 번거로운 값에 쓴다. 복사 후 1.8초간 확인 표시를 남긴다.
 */
export function CopyField({ label, value }: { label: string; value: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // 클립보드를 막아 둔 브라우저 — 직접 고를 수 있게 프롬프트로 보여준다
      window.prompt(label, value);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="flex w-full flex-col items-start gap-1 rounded-xl border border-line bg-card px-4 py-3.5 text-left transition-colors hover:border-line-strong"
    >
      <span className="flex w-full items-center gap-2">
        <span className="text-xs text-muted">{label}</span>
        <span
          className={`ml-auto text-xs font-bold ${copied ? "text-success" : "text-muted"}`}
        >
          {copied ? `${t("common.copied")} ✓` : t("common.copy")}
        </span>
      </span>
      <span className="tabular w-full truncate text-[15px] font-bold">
        {value}
      </span>
    </button>
  );
}
