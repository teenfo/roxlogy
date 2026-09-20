"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Link as LinkIcon, Shield } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Chip, Field, Hint, Panel } from "@/components/rox/ui";

const MASK = "•".repeat(28);

type Notice = { kind: "ok" | "err"; text: string };

/**
 * MCP 연결 — 시안 Settings(연동) Panel "내 AI 연결" 그대로: .rx-info-grid(데이터 조회 · 변경 권한 별도 관리) · p · Hint.
 * 개인 토큰 표시/재발급/폐기, 변경 허용 토글, 클라이언트 등록 안내는 우리 것이라 Field·code·Button·.rx-switch-row 로(§4).
 *
 * 토큰 값은 클라이언트가 만들지 않는다. profiles_privileged_guard 가 mcp_token
 * UPDATE 를 관리자에게도 막기 때문에(예측 가능한 토큰 방지) 재발급·폐기는 서버가 난수를
 * 만드는 RPC(mcp_token_regen / mcp_token_revoke)만 쓰고, 실패는 반드시 화면에 보여 준다.
 *
 * writeEnabled 는 profiles.mcp_write. 호출부가 안 넘기면 마운트 후 직접 읽는다.
 */
export function McpConnect({ token: initialToken, writeEnabled }: { token: string; writeEnabled?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [token, setToken] = useState(initialToken);
  // null = 아직 모름(로딩) — 그동안 토글은 비활성
  const [write, setWrite] = useState<boolean | null>(writeEnabled ?? null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (writeEnabled !== undefined) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data, error } = await supabase.from("profiles").select("mcp_write").eq("id", user.id).single();
      if (cancelled) return;
      if (error) setLoadErr(error.message);
      else setWrite(Boolean(data?.mcp_write));
    })();
    return () => {
      cancelled = true;
    };
  }, [writeEnabled]);

  const endpoint = "https://roxlogy.com/api/mcp";
  const cmd = (tok: string) => `claude mcp add --transport http roxlogy ${endpoint} --header "Authorization: Bearer ${tok}"`;

  async function copy(key: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  /** 재발급(토큰이 있을 때) / 발급(폐기 후). 값은 서버가 만들어 돌려준다. */
  async function regen(confirmFirst: boolean) {
    if (confirmFirst && !confirm(t("mcp.regenConfirm"))) return;
    setBusy(true);
    setNotice(null);
    const { data, error } = await createClient().rpc("mcp_token_regen");
    setBusy(false);
    if (error || typeof data !== "string" || data.length < 24) {
      setNotice({ kind: "err", text: t("mcp.regenFail", { msg: error?.message ?? "empty" }) });
      return;
    }
    setToken(data);
    // 새 토큰을 자동으로 드러내지 않는다 — 공용 화면에서 재발급할 수 있다.
    setShow(false);
    setNotice({ kind: "ok", text: t("mcp.regenDone") });
    router.refresh();
  }

  async function revoke() {
    if (!confirm(t("mcp.revokeConfirm"))) return;
    setBusy(true);
    setNotice(null);
    const { error } = await createClient().rpc("mcp_token_revoke");
    setBusy(false);
    if (error) {
      setNotice({ kind: "err", text: t("mcp.revokeFail", { msg: error.message }) });
      return;
    }
    setToken("");
    setShow(false);
    setNotice({ kind: "ok", text: t("mcp.revokeDone") });
    router.refresh();
  }

  async function toggleWrite(next: boolean) {
    // 켜는 쪽만 확인받는다 — 끄는 건 항상 안전한 방향이다
    if (next && !confirm(t("mcp.writeOnConfirm"))) return;
    setBusy(true);
    setNotice(null);
    const { data, error } = await createClient().rpc("mcp_set_write", { p_on: next });
    setBusy(false);
    if (error) {
      setNotice({ kind: "err", text: t("mcp.writeFail", { msg: error.message }) });
      return;
    }
    const on = Boolean(data);
    setWrite(on);
    setNotice({ kind: "ok", text: on ? t("mcp.writeOnDone") : t("mcp.writeOffDone") });
    router.refresh();
  }

  const hasToken = token.length > 0;
  const codeStyle: React.CSSProperties = { display: "block", padding: "10px 12px", border: "1px solid #dfe5eb", borderRadius: 8, background: "#f7f8fa", fontSize: 13, overflowWrap: "anywhere" };
  /** 라벨 · 코드 · 복사 버튼 한 줄 */
  const codeRow = (key: string, label: string, display: string, value: string) => (
    <Field label={label}>
      <code style={codeStyle}>{display}</code>
      <div className="rx-actions" style={{ marginTop: 8 }}>
        <Button type="button" variant="outline" size="sm" onClick={() => copy(key, value)}>
          {copied === key ? t("mcp.copied") : t("mcp.copy")}
        </Button>
        {key === "tk" && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setShow((v) => !v)}>
            {show ? t("mcp.hide") : t("mcp.show")}
          </Button>
        )}
      </div>
    </Field>
  );

  return (
    <Panel
      title={t("mcp.title")}
      action={
        write === true ? <Chip tone="yellow">{t("mcp.writeOn")}</Chip> : write === false ? <Chip tone="blue">{t("mcp.readOnly")}</Chip> : undefined
      }
    >
      <div className="rx-info-grid">
        <span>
          <LinkIcon size={18} />
          <b>{t("mcp.endpoint")}</b>
        </span>
        <span>
          <Shield size={18} />
          <b>{t("mcp.writeTitle")}</b>
        </span>
      </div>
      <p>{t("mcp.desc")}</p>

      {codeRow("ep", t("mcp.endpoint"), endpoint, endpoint)}
      {hasToken ? (
        codeRow("tk", t("mcp.token"), show ? token : MASK, token)
      ) : (
        <Field label={t("mcp.token")}>
          <Hint>{t("mcp.noToken")}</Hint>
          <Button type="button" className="rx-primary" onClick={() => regen(false)} disabled={busy}>
            {t("mcp.issue")}
          </Button>
        </Field>
      )}

      {/* Claude Code 한 줄 등록 — 토큰을 가린 상태에서도 복사는 실제 값 */}
      {hasToken && codeRow("cmd", t("mcp.claudeCode"), cmd(show ? token : "••••••••"), cmd(token))}
      {/* 다른 클라이언트(ChatGPT·Codex 등) — 둘 다 토큰이 그대로 들어가므로 URL 을 공유·게시하면 안 된다 */}
      {hasToken && (
        <>
          <Hint>
            <b>{t("mcp.otherClients")}</b> · {t("mcp.otherClientsDesc")}
          </Hint>
          {codeRow("url", t("mcp.tokenUrl"), `${endpoint}?token=${show ? token : "••••••••"}`, `${endpoint}?token=${token}`)}
          {codeRow("hdr", t("mcp.authHeader"), `Authorization: Bearer ${show ? token : "••••••••"}`, `Bearer ${token}`)}
        </>
      )}

      {/* 변경 허용 — 서버가 강제하는 유일한 범위 스위치. 켜면 무엇이 가능한지 그대로 적는다 */}
      <label className="rx-switch-row">
        <span>
          <b>{t("mcp.writeTitle")}</b>
          <small>
            {t("mcp.writeDesc")} · {t("mcp.writeActionsMine")} · {t("mcp.writeActionsStaff")}
          </small>
        </span>
        <Switch checked={write === true} onCheckedChange={toggleWrite} aria-label={t("mcp.writeTitle")} disabled={busy || write === null} />
      </label>
      <Hint>{t("mcp.writeNote")}</Hint>
      {loadErr && (
        <p className="rx-error" role="alert">
          {t("mcp.loadFail", { msg: loadErr })}
        </p>
      )}
      {notice && (
        <p role={notice.kind === "err" ? "alert" : "status"} className={notice.kind === "err" ? "rx-error" : "rx-hint"}>
          {notice.text}
        </p>
      )}

      {hasToken && (
        <>
          <div className="rx-actions">
            <Button type="button" variant="outline" onClick={() => regen(true)} disabled={busy}>
              {t("mcp.regen")}
            </Button>
            <Button type="button" variant="ghost" className="rx-pft-close" onClick={revoke} disabled={busy}>
              {t("mcp.revoke")}
            </Button>
          </div>
          <Hint>{t("mcp.regenNote")}</Hint>
        </>
      )}
    </Panel>
  );
}
