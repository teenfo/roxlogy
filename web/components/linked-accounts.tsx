"use client";

import { useEffect, useState } from "react";
import type { UserIdentity } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

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

/** 프로필 설정 — 로그인 수단(이메일/구글) 조회·추가 연동·해제 */
export function LinkedAccounts() {
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

  const providerLabel = (p: string) =>
    p === "google"
      ? t("profile.provider.google")
      : p === "email"
        ? t("profile.provider.email")
        : p;

  return (
    <section className="mt-6 max-w-md rounded-md bg-surface px-4 py-4">
      <p className="text-sm font-semibold">{t("profile.linkedTitle")}</p>

      {identities === null ? (
        <p className="mt-3 text-xs text-muted">…</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {identities.map((id) => (
            <li
              key={id.identity_id ?? `${id.provider}-${id.id}`}
              className="flex items-center justify-between rounded-md bg-background px-3 py-2 text-sm"
            >
              <span className="flex items-center gap-2">
                {id.provider === "google" && <GoogleIcon />}
                {providerLabel(id.provider)}
                <span className="text-xs text-muted">
                  {(id.identity_data?.email as string | undefined) ?? ""}
                </span>
              </span>
              {id.provider === "google" &&
                ((identities.length >= 2 && (
                  <button
                    type="button"
                    onClick={handleUnlink}
                    disabled={busy !== null}
                    className="text-xs text-muted hover:text-red-400 disabled:opacity-50"
                  >
                    {busy === "unlink"
                      ? t("profile.unlinking")
                      : t("profile.unlink")}
                  </button>
                )) || (
                  <span className="text-xs text-muted">
                    {t("profile.lastIdentity")}
                  </span>
                ))}
            </li>
          ))}
        </ul>
      )}

      {identities !== null && !google && (
        <button
          type="button"
          onClick={handleLink}
          disabled={busy !== null}
          className="mt-3 flex items-center gap-2 rounded-md border border-muted/40 px-4 py-2 text-sm font-semibold hover:border-foreground disabled:opacity-50"
        >
          <GoogleIcon />
          {busy === "link" ? t("profile.linking") : t("profile.linkGoogle")}
        </button>
      )}

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </section>
  );
}
