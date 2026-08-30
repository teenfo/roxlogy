"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

/** MCP 연결 — 개인 토큰 표시/재발급과 클라이언트 등록 안내 (설정 페이지) */
export function McpConnect({ token }: { token: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const endpoint = "https://roxlogy.com/api/mcp";
  const cmd = `claude mcp add --transport http roxlogy ${endpoint} --header "Authorization: Bearer ${token}"`;

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

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{t("mcp.desc")}</p>

      <div>
        <p className="text-xs text-muted">{t("mcp.endpoint")}</p>
        <div className="mt-1 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md bg-background px-3 py-2 font-mono text-xs">
            {endpoint}
          </code>
          <button
            type="button"
            onClick={() => copy("ep", endpoint)}
            className="shrink-0 rounded-md border border-muted/40 px-2.5 py-1.5 text-xs hover:border-foreground"
          >
            {copied === "ep" ? t("mcp.copied") : t("mcp.copy")}
          </button>
        </div>
      </div>

      <div>
        <p className="text-xs text-muted">{t("mcp.token")}</p>
        <div className="mt-1 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md bg-background px-3 py-2 font-mono text-xs">
            {show ? token : "•".repeat(24)}
          </code>
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="shrink-0 rounded-md border border-muted/40 px-2.5 py-1.5 text-xs hover:border-foreground"
          >
            {show ? t("mcp.hide") : t("mcp.show")}
          </button>
          <button
            type="button"
            onClick={() => copy("tk", token)}
            className="shrink-0 rounded-md border border-muted/40 px-2.5 py-1.5 text-xs hover:border-foreground"
          >
            {copied === "tk" ? t("mcp.copied") : t("mcp.copy")}
          </button>
        </div>
      </div>

      <div>
        <p className="text-xs text-muted">{t("mcp.claudeCode")}</p>
        <div className="mt-1 flex items-start gap-2">
          <code className="min-w-0 flex-1 whitespace-pre-wrap break-all rounded-md bg-background px-3 py-2 font-mono text-[11px] leading-relaxed">
            {cmd}
          </code>
          <button
            type="button"
            onClick={() => copy("cmd", cmd)}
            className="shrink-0 rounded-md border border-muted/40 px-2.5 py-1.5 text-xs hover:border-foreground"
          >
            {copied === "cmd" ? t("mcp.copied") : t("mcp.copy")}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted">{t("mcp.regenNote")}</p>
        <button
          type="button"
          onClick={regen}
          disabled={busy}
          className="shrink-0 rounded-md border border-red-400/40 px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-400/10 disabled:opacity-40"
        >
          {t("mcp.regen")}
        </button>
      </div>
    </div>
  );
}
