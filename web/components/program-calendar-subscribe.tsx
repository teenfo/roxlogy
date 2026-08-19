"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

/** 캘린더 구독 URL 복사 — 구글/애플 캘린더의 "URL 로 추가"에 붙여넣으면
 *  프로그램 수정이 자동 반영된다(갱신 주기는 캘린더 서비스가 결정).
 *  소유자는 토큰 재발급으로 기존 구독 URL 을 무효화할 수 있다. */
export function ProgramCalendarSubscribe({
  programId,
  token,
  isOwner = false,
}: {
  programId: string;
  token: string;
  isOwner?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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

  async function regenerate() {
    if (!window.confirm(t("programs.tokenRegenConfirm"))) return;
    setBusy(true);
    setErr(null);
    // 새 토큰은 클라이언트에서 생성 — 기존 구독 URL 은 즉시 무효화된다
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const next = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const supabase = createClient();
    const { error } = await supabase
      .from("programs")
      .update({ calendar_token: next })
      .eq("id", programId);
    setBusy(false);
    if (error) setErr(error.message);
    else router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={copy}
        className="rounded-md bg-surface px-2.5 py-1 text-xs font-semibold text-foreground hover:text-accent"
      >
        {copied ? `✓ ${t("programs.copied")}` : `🔗 ${t("programs.subscribeCopy")}`}
      </button>
      {isOwner && (
        <button
          type="button"
          onClick={regenerate}
          disabled={busy}
          title={t("programs.tokenRegenConfirm")}
          className="rounded-md bg-surface px-2.5 py-1 text-xs text-muted hover:text-red-400 disabled:opacity-50"
        >
          ↻ {t("programs.tokenRegen")}
        </button>
      )}
      {err && <span className="text-xs text-red-400">{err}</span>}
    </>
  );
}
