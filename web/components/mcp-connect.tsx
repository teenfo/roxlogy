"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import {
  Toggle,
  btnDanger,
  btnGhost,
  btnPrimary,
} from "@/components/ui/settings-ui";

const MASK = "•".repeat(28);

type Notice = { kind: "ok" | "err"; text: string };

/**
 * MCP 연결 — 개인 토큰 표시/재발급/폐기, 변경 허용 토글, 클라이언트 등록 안내
 * (설정 페이지).
 *
 * 토큰 값은 클라이언트가 만들지 않는다. profiles_privileged_guard 가 mcp_token
 * UPDATE 를 관리자에게도 막기 때문에(예측 가능한 토큰 방지) 예전의 직접 UPDATE
 * 는 조용히 실패하고 옛 토큰이 남았다(감사 A01). 재발급·폐기는 서버가 난수를
 * 만드는 RPC(mcp_token_regen / mcp_token_revoke)만 쓰고, 실패는 반드시 화면에
 * 보여 준다 — 실패를 숨기면 사용자는 유출된 토큰이 회수됐다고 믿는다.
 *
 * writeEnabled 는 profiles.mcp_write. 호출부가 안 넘기면 마운트 후 직접 읽는다.
 */
export function McpConnect({
  token: initialToken,
  writeEnabled,
}: {
  token: string;
  writeEnabled?: boolean;
}) {
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
      const { data, error } = await supabase
        .from("profiles")
        .select("mcp_write")
        .eq("id", user.id)
        .single();
      if (cancelled) return;
      if (error) setLoadErr(error.message);
      else setWrite(Boolean(data?.mcp_write));
    })();
    return () => {
      cancelled = true;
    };
  }, [writeEnabled]);

  const endpoint = "https://roxlogy.com/api/mcp";
  const cmd = (tok: string) =>
    `claude mcp add --transport http roxlogy ${endpoint} --header "Authorization: Bearer ${tok}"`;

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
      setNotice({
        kind: "err",
        text: t("mcp.regenFail", { msg: error?.message ?? "empty" }),
      });
      return;
    }
    setToken(data);
    // 새 토큰을 자동으로 드러내지 않는다 — 공용 화면에서 재발급할 수 있다.
    // 값이 필요하면 '보기'/'복사'로 꺼낸다(복사는 가린 상태에서도 실제 값).
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
      setNotice({
        kind: "err",
        text: t("mcp.revokeFail", { msg: error.message }),
      });
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
    const { data, error } = await createClient().rpc("mcp_set_write", {
      p_on: next,
    });
    setBusy(false);
    if (error) {
      setNotice({
        kind: "err",
        text: t("mcp.writeFail", { msg: error.message }),
      });
      return;
    }
    const on = Boolean(data);
    setWrite(on);
    setNotice({
      kind: "ok",
      text: on ? t("mcp.writeOnDone") : t("mcp.writeOffDone"),
    });
    router.refresh();
  }

  // truncate 는 flex 컨테이너에서 듣지 않는다 — block + leading 으로 높이를 맞춘다
  const code =
    "block h-[38px] min-w-0 truncate rounded-lg border border-line-mid bg-page px-3 font-mono text-[13px] leading-[38px] text-foreground/90";

  const hasToken = token.length > 0;

  return (
    <>
      <div className="border-b border-line px-[22px] py-[18px] max-md:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[15px] font-extrabold">{t("mcp.title")}</h3>
          {/* 배지는 실제 상태를 말한다 — 예전엔 항상 "읽기 전용"이라 거짓이었다 */}
          {write === true ? (
            <span className="rounded-[5px] border border-line-accent bg-highlight px-2 py-[3px] text-xs font-bold text-accent">
              {t("mcp.writeOn")}
            </span>
          ) : write === false ? (
            <span className="rounded-[5px] bg-label-bg px-2 py-[3px] text-xs font-bold text-label">
              {t("mcp.readOnly")}
            </span>
          ) : null}
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

        {hasToken ? (
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
        ) : (
          <div className="grid grid-cols-[110px_minmax(0,1fr)_auto] items-center gap-3 max-md:grid-cols-1 max-md:gap-1.5">
            <span className="text-[13px] text-muted">{t("mcp.token")}</span>
            <p className="text-[13px] text-muted">{t("mcp.noToken")}</p>
            <button
              type="button"
              onClick={() => regen(false)}
              disabled={busy}
              className={`${btnPrimary} max-md:self-end`}
            >
              {t("mcp.issue")}
            </button>
          </div>
        )}

        {/* Claude Code 한 줄 등록 — 토큰을 가린 상태에서도 복사는 실제 값 */}
        {hasToken && (
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
        )}

        {/* 다른 클라이언트(ChatGPT·Codex 등) — 헤더를 못 쓰는 곳은 ?token= URL, 헤더 칸이 있으면
            Authorization 값. 둘 다 토큰이 그대로 들어가므로 URL 을 공유·게시하면 안 된다 */}
        {hasToken && (
          <div className="rounded-[10px] border border-line-soft bg-inset p-3.5">
            <p className="text-[13px] font-bold">{t("mcp.otherClients")}</p>
            <p className="mt-1 text-xs text-muted">{t("mcp.otherClientsDesc")}</p>
            <div className="mt-2.5 flex flex-col gap-2">
              {(
                [
                  ["url", t("mcp.tokenUrl"), `${endpoint}?token=${token}`, `${endpoint}?token=${show ? token : "••••••••"}`],
                  ["hdr", t("mcp.authHeader"), `Bearer ${token}`, `Authorization: Bearer ${show ? token : "••••••••"}`],
                ] as const
              ).map(([key, label, value, display]) => (
                <div
                  key={key}
                  className="grid grid-cols-[110px_minmax(0,1fr)_auto] items-center gap-3 max-md:grid-cols-1 max-md:gap-1.5"
                >
                  <span className="text-[13px] text-muted">{label}</span>
                  <code className={code}>{display}</code>
                  <button
                    type="button"
                    onClick={() => copy(key, value)}
                    className={`${btnGhost} max-md:self-end`}
                  >
                    {copied === key ? t("mcp.copied") : t("mcp.copy")}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 변경 허용 — 서버가 강제하는 유일한 범위 스위치. 켜면 무엇이 가능한지 그대로 적는다 */}
        <div className="rounded-[10px] border border-line-soft bg-inset p-3.5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold">{t("mcp.writeTitle")}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {t("mcp.writeDesc")}
              </p>
            </div>
            <Toggle
              checked={write === true}
              onChange={toggleWrite}
              label={t("mcp.writeTitle")}
              disabled={busy || write === null}
            />
          </div>
          <ul className="mt-2.5 flex list-disc flex-col gap-1 pl-4 text-xs leading-relaxed text-foreground/80">
            <li>{t("mcp.writeActionsMine")}</li>
            <li>{t("mcp.writeActionsStaff")}</li>
          </ul>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            {t("mcp.writeNote")}
          </p>
          {loadErr && (
            <p className="mt-2 text-xs text-danger" role="alert">
              {t("mcp.loadFail", { msg: loadErr })}
            </p>
          )}
        </div>

        {notice && (
          <p
            role={notice.kind === "err" ? "alert" : "status"}
            className={`text-xs font-semibold ${
              notice.kind === "err" ? "text-danger" : "text-accent"
            }`}
          >
            {notice.text}
          </p>
        )}
      </div>

      {hasToken && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line bg-inset px-[22px] py-3.5 max-md:px-4">
          <p className="min-w-0 flex-1 text-xs text-muted">
            {t("mcp.regenNote")}
          </p>
          <button
            type="button"
            onClick={() => regen(true)}
            disabled={busy}
            className={btnDanger}
          >
            {t("mcp.regen")}
          </button>
          <button
            type="button"
            onClick={revoke}
            disabled={busy}
            className={btnDanger}
          >
            {t("mcp.revoke")}
          </button>
        </div>
      )}
    </>
  );
}
