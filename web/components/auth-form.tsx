"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { safeNext } from "@/lib/site-url";
import { KEEP_COOKIE } from "@/lib/supabase/keep";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
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

function AuthFormInner({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // 로그인 상태 유지. 기본은 켬(기존 동작 = 400일 쿠키).
  // 끄면 인증 쿠키가 세션 쿠키가 되어 브라우저를 닫을 때 사라진다 — 공용 PC 용.
  // 로그인 직전에 표시를 남겨야 인증 쿠키가 처음 구워질 때부터 반영된다.
  const [keep, setKeep] = useState(true);
  function applyKeep() {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = keep
      ? `${KEEP_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`
      : `${KEEP_COOKIE}=0; Path=/; SameSite=Lax${secure}`;
  }

  // 로그인 ↔ 가입 이동에도 목적지를 들고 다닌다
  const nextQs = (() => {
    const n = safeNext(searchParams.get("next"));
    return n ? `?next=${encodeURIComponent(n)}` : "";
  })();

  async function handleGoogle() {
    setError(null);
    applyKeep();
    const supabase = createClient();
    const next = safeNext(searchParams.get("next"));
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${location.origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ""}`,
      },
    });
    if (error) setError(error.message);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    applyKeep();
    const supabase = createClient();

    const signupNext = safeNext(searchParams.get("next"));

    if (mode === "signup") {
      // 이름은 handle_new_user 트리거가 raw_user_meta_data 에서 읽어 프로필에
      // 넣는다. 여기서 안 보내면 명단·출석·회비 화면이 전부 'Athlete' 가 된다.
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // 공유 링크를 받고 처음 가입하는 사람도 원래 보려던 페이지로 돌아가야 한다
          emailRedirectTo: `${location.origin}/auth/callback${
            signupNext ? `?next=${encodeURIComponent(signupNext)}` : ""
          }`,
          data: { display_name: displayName.trim() },
        },
      });
      setPending(false);
      if (error) return setError(error.message);
      if (data.session) return router.push(signupNext ?? "/dashboard");
      setNotice(t("auth.confirmSent"));
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      setPending(false);
      if (error) return setError(t("auth.errInvalid"));
      router.push(safeNext(searchParams.get("next")) ?? "/dashboard");
      router.refresh();
    }
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <Link href="/">
        <Image src="/roxlogy-mark.svg" alt="Roxlogy" width={64} height={64} />
      </Link>
      <h1 className="mt-6 text-2xl font-bold">
        {mode === "login" ? t("auth.loginTitle") : t("auth.signupTitle")}
      </h1>

      <div className="mt-8 flex w-full max-w-sm flex-col gap-4">
        <button
          type="button"
          onClick={handleGoogle}
          className="flex items-center justify-center gap-2.5 rounded-md border border-muted/40 bg-surface px-4 py-2.5 text-sm font-semibold hover:border-foreground"
        >
          <GoogleIcon />
          {t("auth.google")}
        </button>

        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-muted/30" />
          {t("auth.or")}
          <span className="h-px flex-1 bg-muted/30" />
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {mode === "signup" && (
            <label className="flex flex-col gap-1.5 text-sm text-muted">
              {t("auth.displayName")}
              <input
                type="text"
                required
                maxLength={40}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t("auth.displayNamePh")}
                className="rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-foreground outline-none focus:border-accent"
              />
              <span className="text-xs text-muted">{t("auth.displayNameHint")}</span>
            </label>
          )}
          <label className="flex flex-col gap-1.5 text-sm text-muted">
            {t("auth.email")}
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-foreground outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-muted">
            {t("auth.password")}
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-muted/30 bg-surface px-3 py-2.5 pr-16 text-foreground outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-2 my-auto h-7 rounded px-2 text-xs font-semibold text-muted hover:text-foreground"
              >
                {showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
              </button>
            </div>
          </label>

          {/* 공용 PC 에서 끄라고 두는 스위치 — 끄면 브라우저를 닫을 때 로그아웃된다 */}
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={keep}
              onChange={(e) => setKeep(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-accent"
            />
            <span>
              {t("auth.keepSignedIn")}
              <span className="block text-xs text-muted">
                {t("auth.keepSignedInHint")}
              </span>
            </span>
          </label>

          {error && <p className="text-sm text-red-400">{error}</p>}
          {notice && <p className="text-sm text-track">{notice}</p>}

          <button
            type="submit"
            disabled={pending || (mode === "signup" && !displayName.trim())}
            className="mt-2 rounded-md bg-accent px-4 py-2.5 font-bold text-background hover:brightness-110 disabled:opacity-40"
          >
            {pending
              ? t("auth.processing")
              : mode === "login"
                ? t("auth.submitLogin")
                : t("auth.submitSignup")}
          </button>
        </form>

        <p className="text-center text-sm text-muted">
          {mode === "login" ? (
            <>
              {t("auth.noAccount")}{" "}
              <Link href={`/signup${nextQs}`} className="text-accent hover:underline">
                {t("auth.submitSignup")}
              </Link>
            </>
          ) : (
            <>
              {t("auth.haveAccount")}{" "}
              <Link href={`/login${nextQs}`} className="text-accent hover:underline">
                {t("auth.submitLogin")}
              </Link>
            </>
          )}
        </p>
      </div>
    </main>
  );
}

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  return (
    <Suspense>
      <AuthFormInner mode={mode} />
    </Suspense>
  );
}
