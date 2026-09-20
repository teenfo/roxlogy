"use client";

import { useEffect, useState } from "react";
import type { UserIdentity } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/rox/ui";

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.1 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.6 39.6 16.3 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C41.4 34.9 44 30 44 24c0-1.3-.1-2.6-.4-3.9z" />
    </svg>
  );
}

/**
 * 로그인 수단(이메일/구글) 조회·추가 연동·해제 — 시안 Settings(계정) Panel 안의 .rx-switch-row 두 줄(§4).
 * 카드 셸(제목)은 페이지가 그린다.
 */
export function LinkedAccounts({ email }: { email: string }) {
  const { t } = useI18n();
  const [identities, setIdentities] = useState<UserIdentity[] | null>(null);
  const [busy, setBusy] = useState<"link" | "unlink" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    createClient()
      .auth.getUserIdentities()
      .then(({ data }) => {
        if (!cancelled) setIdentities(data?.identities ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function reload() {
    const supabase = createClient();
    const { data } = await supabase.auth.getUserIdentities();
    setIdentities(data?.identities ?? []);
  }

  const google = identities?.find((i) => i.provider === "google");

  async function handleLink() {
    setError(null);
    setBusy("link");
    const supabase = createClient();
    const { error } = await supabase.auth.linkIdentity({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent("/settings/profile")}` },
    });
    if (error) {
      setBusy(null);
      setError(t("profile.linkErr", { msg: error.message }));
    }
    // 성공 시 구글로 리다이렉트되므로 여기 도달하지 않음
  }

  async function handleUnlink() {
    if (!google || (identities?.length ?? 0) < 2) return;
    setError(null);
    setBusy("unlink");
    const supabase = createClient();
    const { error } = await supabase.auth.unlinkIdentity(google);
    setBusy(null);
    if (error) return setError(t("profile.linkErr", { msg: error.message }));
    await reload();
  }

  const googleEmail = (google?.identity_data?.email as string | undefined) ?? null;

  return (
    <>
      {/* 이메일 — 가입 수단이라 항상 있다 */}
      <div className="rx-switch-row">
        <span>
          <b>{t("profile.provider.email")}</b>
          <small>{email}</small>
        </span>
        <Chip tone="green">{t("profile.primary")}</Chip>
      </div>

      {/* 구글 — 연결/해제 */}
      <div className="rx-switch-row">
        <span>
          <b style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <GoogleIcon />
            {t("profile.provider.google")}
          </b>
          <small>{identities === null ? "…" : google ? [googleEmail, t("profile.connected")].filter(Boolean).join(" · ") : t("profile.notConnected")}</small>
        </span>
        {identities !== null &&
          (google ? (
            identities.length >= 2 ? (
              <Button type="button" variant="outline" size="sm" onClick={handleUnlink} disabled={busy !== null}>
                {busy === "unlink" ? t("profile.unlinking") : t("profile.unlink")}
              </Button>
            ) : (
              <Chip>{t("profile.lastIdentity")}</Chip>
            )
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={handleLink} disabled={busy !== null}>
              {busy === "link" ? t("profile.linking") : t("common.connect")}
            </Button>
          ))}
      </div>

      {error && (
        <p role="alert" className="rx-error">
          {error}
        </p>
      )}
    </>
  );
}
