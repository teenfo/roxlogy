"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

/**
 * "AI 프로그램 생성" — 최근 코칭 인사이트 기반 7일 프로그램 생성을 큐에 요청.
 * 생성은 백그라운드(분석 크론 → llm-gateway 32b)로 수분 걸리며, 완료되면
 * 푸시 알림(ai_program)이 오고 프로그램 목록에 나타난다.
 */
export function AiProgramButton() {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "busy" | "queued" | "exists" | "error">("idle");

  async function request() {
    setState("busy");
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      setState("error");
      return;
    }
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/ai-program-request`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.status === 202) setState("queued");
      else if (res.status === 409) setState("exists");
      else setState("error");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={request}
        disabled={state === "busy" || state === "queued"}
        className="rounded-md border border-accent/50 px-4 py-2 text-sm font-bold text-accent hover:bg-accent/10 disabled:opacity-50"
      >
        {state === "busy" ? t("ai.program.requesting") : t("ai.program.button")}
      </button>
      {state === "queued" && (
        <p className="text-xs text-track">{t("ai.program.queued")}</p>
      )}
      {state === "exists" && (
        <p className="text-xs text-muted">{t("ai.program.exists")}</p>
      )}
      {state === "error" && <p className="text-xs text-red-400">{t("ai.program.err")}</p>}
    </div>
  );
}
