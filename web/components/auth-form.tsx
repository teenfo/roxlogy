"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Activity, ArrowRight, Check, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { rememberNext, safeNext } from "@/lib/site-url";
import { KEEP_COOKIE } from "@/lib/supabase/keep";
import { GoogleOneTap } from "@/components/google-one-tap";
import { PublicHeader } from "@/components/rox/public-header";
import { Field, Go } from "@/components/rox/ui";

/**
 * 로그인·가입 — 시안 public-screens.tsx 의 AuthScreen 그대로 (PORT_PLAN §3-a).
 * .rx-auth-layout[aside 소개 | .rx-auth-card 폼]. 인증 로직은 우리 것(Supabase)
 * 그대로다. 시안의 미리보기 상태 선택기·Google 안내 다이얼로그는 넣지 않고
 * 실제 OAuth 와 One Tap(정책: 확정 4)을 쓴다. 가입 확인 메일을 보낸 뒤에는
 * 시안의 완료 상태(체크 아이콘 + 안내)를 보여 준다.
 */
function AuthFormInner({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const signup = mode === "signup";
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
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
  const next = safeNext(searchParams.get("next"));
  const nextQs = next ? `?next=${encodeURIComponent(next)}` : "";

  async function handleGoogle() {
    setError(null);
    applyKeep();
    const supabase = createClient();
    // 목적지는 쿠키로 — redirectTo 에 쿼리를 붙이면 Supabase 허용 목록에
    // 걸려 Site URL(첫 화면)로 떨어진다. rememberNext 주석 참고.
    rememberNext(searchParams.get("next"));
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
    if (error) setError(error.message);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    applyKeep();
    const supabase = createClient();

    if (signup) {
      // 이름은 handle_new_user 트리거가 raw_user_meta_data 에서 읽어 프로필에
      // 넣는다. 여기서 안 보내면 명단·출석·회비 화면이 전부 'Athlete' 가 된다.
      // 확인 메일은 다른 기기에서 열릴 수 있어 쿼리도 함께 남긴다.
      // 쿠키는 같은 브라우저로 돌아오는 경우의 보험이다.
      rememberNext(next);
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // 공유 링크를 받고 처음 가입하는 사람도 원래 보려던 페이지로 돌아가야 한다
          emailRedirectTo: `${location.origin}/auth/callback${nextQs}`,
          data: { display_name: displayName.trim() },
        },
      });
      setPending(false);
      if (error) return setError(error.message);
      if (data.session) return router.push(next ?? "/dashboard");
      setPassword("");
      setSent(true);
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      setPending(false);
      if (error) return setError(t("auth.errInvalid"));
      router.push(next ?? "/dashboard");
      router.refresh();
    }
  }

  return (
    <div className="rx-public">
      <PublicHeader loginNext={next ?? undefined} />
      <main className="rx-auth-layout">
        <aside>
          <span className="rx-kicker">YOUR NEXT PERSONAL BEST</span>
          <h1>{t("landing.headline")}</h1>
          <div>
            <Activity size={30} />
            <p>{t("landing.intro")}</p>
          </div>
        </aside>
        <section className="rx-auth-card">
          {sent ? (
            <>
              <span className="rx-state-icon">
                <Check />
              </span>
              <h1>{t("auth.confirmSent")}</h1>
              <p>{email}</p>
              <Go href={`/login${nextQs}`} primary>
                {t("auth.submitLogin")}
              </Go>
            </>
          ) : (
            <>
              <span className="rx-kicker">ROXLOGY ACCOUNT</span>
              <h1>{signup ? t("auth.signupTitle") : t("auth.welcome")}</h1>
              <p>{signup ? t("auth.signupIntro") : t("auth.intro")}</p>
              <Button
                variant="outline"
                className="rx-google"
                type="button"
                onClick={handleGoogle}
              >
                <b aria-hidden="true">G</b>
                {t("auth.google")}
              </Button>
              <div className="rx-auth-divider">{t("auth.or")}</div>
              <form onSubmit={handleSubmit}>
                {signup && (
                  <Field label={t("auth.displayName")}>
                    <Input
                      required
                      maxLength={40}
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder={t("auth.displayNamePh")}
                      aria-describedby="name-help"
                    />
                    <small id="name-help">{t("auth.displayNameHint")}</small>
                  </Field>
                )}
                <Field label={t("auth.email")}>
                  <Input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
                <Field label={t("auth.password")}>
                  <Input
                    type={show ? "text" : "password"}
                    required
                    minLength={8}
                    autoComplete={signup ? "new-password" : "current-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-describedby="password-help"
                  />
                  <small id="password-help">{t("auth.passwordHint")}</small>
                </Field>
                <label className="rx-check">
                  <input
                    type="checkbox"
                    checked={show}
                    onChange={(e) => setShow(e.target.checked)}
                  />
                  {t("auth.showPassword")}
                </label>
                {/* 공용 PC 에서 끄라고 두는 스위치 — 끄면 브라우저를 닫을 때 로그아웃된다 */}
                <label className="rx-check">
                  <input
                    type="checkbox"
                    checked={keep}
                    onChange={(e) => setKeep(e.target.checked)}
                  />
                  {t("auth.keepSignedIn")}
                </label>
                {error && (
                  <p role="alert" className="rx-error">
                    {error}
                  </p>
                )}
                <Button
                  disabled={pending || (signup && !displayName.trim())}
                  type="submit"
                  className="rx-primary rx-wide"
                >
                  {pending
                    ? t("auth.processing")
                    : signup
                      ? t("auth.submitSignup")
                      : t("auth.submitLogin")}
                </Button>
              </form>
              {/* 원탭 — 이미 구글에 로그인된 브라우저면 카드가 뜬다.
                  안 뜨는 브라우저(사파리 등)에서는 위 버튼이 그대로 동작한다. */}
              <GoogleOneTap next={next ?? undefined} />
              <p className="rx-auth-notice">
                <LockKeyhole size={16} />
                {t("auth.keepSignedInHint")}
              </p>
              <Link
                className="rx-auth-link"
                href={signup ? `/login${nextQs}` : `/signup${nextQs}`}
              >
                {signup ? t("auth.haveAccount") : t("auth.noAccount")}{" "}
                {signup ? t("auth.submitLogin") : t("auth.submitSignup")}
                <ArrowRight size={16} />
              </Link>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  return (
    <Suspense>
      <AuthFormInner mode={mode} />
    </Suspense>
  );
}
