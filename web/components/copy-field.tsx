"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";

/**
 * 클릭하면 값을 클립보드에 복사하는 줄 — 회비 계좌처럼 손으로 옮겨 적기 번거로운 값에 쓴다.
 * 시안 DataTable 행 안에 앉힐 수 있게 라벨 + 값 + outline 버튼으로 그린다. 복사 후 1.8초 확인 표시.
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
    <div className="rx-record-row" style={{ cursor: "default" }}>
      <span>
        <b>{value}</b>
        <small>{label}</small>
      </span>
      <Button variant="outline" size="sm" type="button" onClick={copy}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? t("common.copied") : t("common.copy")}
      </Button>
    </div>
  );
}
