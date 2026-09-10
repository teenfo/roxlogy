"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { btnDanger, btnGhost } from "@/components/ui/settings-ui";

const MASK = "•".repeat(28);

/** MCP 연결 — 개인 토큰 표시/재발급과 클라이언트 등록 안내 (설정 페이지) */
export function McpConnect({ token }: { token: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const endpoint = "https://roxlogy.com/api/mcp";
  const cmd = (tok: string) =>
    `claude mcp add --transport http roxlogy ${endpoint} --header "Authorization: Bearer ${tok}"`;

  async function copy(key: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  async function regen() {
    if (!confirm(t("mcp.regenConfirm"))) return;
    setBusy(true);
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const next = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("profiles")
      .update({ mcp_token: next })
      .eq("id", user!.id);
    setBusy(false);
    if (!error) router.refresh();
  }

  // truncate 는 flex 컨테이너에서 듣지 않는다 — block + leading 으로 높이를 맞춘다
  const code =
    "block h-[38px] min-w-0 truncate rounded-lg border border-line-mid bg-page px-3 font-mono text-[13px] leading-[38px] text-foreground/90";

  return (
    <>
      <div className="border-b border-line px-[22px] py-[18px] max-md:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[15px] font-extrabold">{t("mcp.title")}</h3>
          <span className="rounded-[5px] bg-label-bg px-2 py-[3px] text-[11px] font-bold text-label">
            {t("mcp.readOnly")}
          </span>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-muted">
          {t("mcp.desc")}
        </p>
      </div>

      <div className="flex flex-col gap-3.5 px-[22px] py-4 max-md:px-4">
        {/* 엔드포인트 · 토큰 — 라벨/값/액션 3열, 모바일은 세로 스택 */}
        <div className="grid grid-cols-[110px_minmax(0,1fr)_auto] items-center gap-3 max-md:grid-cols-1 max-md:gap-1.5">
          <span className="text-[13px] text-muted">{t("mcp.endpoint")}</span>
          <code className={code}>{endpoint}</code>
          <button
            type="button"
            onClick={() => copy("ep", endpoint)}
            className={`${btnGhost} max-md:self-end`}
          >
            {copied === "ep" ? t("mcp.copied") : t("mcp.copy")}
          </button>
        </div>

        <div className="grid grid-cols-[110px_minmax(0,1fr)_auto] items-center gap-3 max-md:grid-cols-1 max-md:gap-1.5">
          <span className="text-[13px] text-muted">{t("mcp.token")}</span>
          <code className={`${code} ${show ? "" : "tracking-[.1em]"}`}>
            {show ? token : MASK}
          </code>
          <span className="flex gap-2 max-md:self-end">
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className={btnGhost}
            >
              {show ? t("mcp.hide") : t("mcp.show")}
            </button>
            <button
              type="button"
              onClick={() => copy("tk", token)}
              className={btnGhost}
            >
              {copied === "tk" ? t("mcp.copied") : t("mcp.copy")}
            </button>
          </span>
        </div>

        {/* Claude Code 한 줄 등록 — 토큰을 가린 상태에서도 복사는 실제 값 */}
        <div className="rounded-[10px] border border-line-soft bg-inset p-3.5">
          <div className="flex items-center gap-3">
            <p className="text-[13px] font-bold">{t("mcp.claudeCode")}</p>
            <button
              type="button"
              onClick={() => copy("cmd", cmd(token))}
              className="ml-auto flex h-8 shrink-0 items-center rounded-lg bg-accent px-3 text-[13px] font-extrabold text-background transition hover:brightness-110"
            >
              {copied === "cmd" ? t("mcp.copied") : t("mcp.copyCmd")}
            </button>
          </div>
          <code className="mt-2.5 block whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground/75">
            {cmd(show ? token : "••••••••")}
          </code>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line bg-inset px-[22px] py-3.5 max-md:px-4">
        <p className="min-w-0 flex-1 text-xs text-muted">{t("mcp.regenNote")}</p>
        <button
          type="button"
          onClick={regen}
          disabled={busy}
          className={btnDanger}
        >
          {t("mcp.regen")}
        </button>
      </div>
    </>
  );
}
