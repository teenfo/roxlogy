"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleGoogle() {
    setError(null);
    const supabase = createClient();
    const next = searchParams.get("next");
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
    const supabase = createClient();

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${location.origin}/auth/callback` },
      });
      setPending(false);
      if (error) return setError(error.message);
      if (data.session) return router.push("/dashboard");
      setNotice(t("auth.confirmSent"));
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      setPending(false);
      if (error) return setError(t("auth.errInvalid"));
      router.push(searchParams.get("next") ?? "/dashboard");
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

          {error && <p className="text-sm text-red-400">{error}</p>}
          {notice && <p className="text-sm text-track">{notice}</p>}

          <button
            type="submit"
            disabled={pending}
            className="mt-2 rounded-md bg-accent px-4 py-2.5 font-bold text-background hover:brightness-110 disabled:opacity-50"
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
              <Link href="/signup" className="text-accent hover:underline">
                {t("auth.submitSignup")}
              </Link>
            </>
          ) : (
            <>
              {t("auth.haveAccount")}{" "}
              <Link href="/login" className="text-accent hover:underline">
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
