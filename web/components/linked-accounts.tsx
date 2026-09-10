"use client";

import { useEffect, useState } from "react";
import type { UserIdentity } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { btnGhost } from "@/components/ui/settings-ui";

/** 계정 카드의 행 — 아이콘 / 본문 / 액션 3열 */
const row =
  "grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3.5 border-b border-line-soft px-[22px] py-3.5 last:border-b-0 max-md:px-4";
const iconBox =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-line text-muted";

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.1H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.1 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.6 39.6 16.3 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C41.4 34.9 44 30 44 24c0-1.3-.1-2.6-.4-3.9z"
      />
    </svg>
  );
}

/**
 * 계정 카드 본문 — 로그인 수단(이메일/구글) 조회·추가 연동·해제.
 * 카드 셸(제목·보더)은 페이지가 그린다.
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
      options: {
        redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent("/settings/profile")}`,
      },
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

  const googleEmail =
    (google?.identity_data?.email as string | undefined) ?? null;

  return (
    <>
      {/* 이메일 — 가입 수단이라 항상 있다 */}
      <div className={row}>
        <span className={iconBox} aria-hidden>
          ✉
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{t("profile.provider.email")}</p>
          <p className="truncate text-[13px] text-muted">{email}</p>
        </div>
        <span className="shrink-0 rounded-[5px] bg-success-bg px-2 py-[3px] text-[11px] font-bold text-success">
          {t("profile.primary")}
        </span>
      </div>

      {/* 구글 — 연결/해제. 로딩 중에는 행 높이를 유지해 레이아웃이 튀지 않게 한다 */}
      <div className={row}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-white">
          <GoogleIcon />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{t("profile.provider.google")}</p>
          <p className="truncate text-[13px] text-muted">
            {identities === null
              ? "…"
              : google
                ? [googleEmail, t("profile.connected")].filter(Boolean).join(" · ")
                : t("profile.notConnected")}
          </p>
        </div>
        {identities !== null &&
          (google ? (
            identities.length >= 2 ? (
              <button
                type="button"
                onClick={handleUnlink}
                disabled={busy !== null}
                className={`${btnGhost} hover:border-danger-line-strong hover:text-danger`}
              >
                {busy === "unlink" ? t("profile.unlinking") : t("profile.unlink")}
              </button>
            ) : (
              <span className="max-w-[9rem] shrink-0 text-right text-[11px] text-muted">
                {t("profile.lastIdentity")}
              </span>
            )
          ) : (
            <button
              type="button"
              onClick={handleLink}
              disabled={busy !== null}
              className={btnGhost}
            >
              {busy === "link" ? t("profile.linking") : t("common.connect")}
            </button>
          ))}
      </div>

      {error && (
        <p className="px-[22px] pb-3 text-xs text-danger max-md:px-4">{error}</p>
      )}
    </>
  );
}
