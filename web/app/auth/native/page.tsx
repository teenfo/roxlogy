"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Monitor } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { PublicHeader } from "@/components/rox/public-header";
import { Go, Panel } from "@/components/rox/ui";

/**
 * 네이티브 앱 → 웹 자동 로그인 핸드셰이크. 화면은 시안 NativeAuth 그대로
 * (.rx-state-page + .rx-native-steps, PORT_PLAN §3-a).
 *
 * 네이티브 WebView가 `/auth/native#access_token=..&refresh_token=..&next=/dashboard` 로
 * 진입하면 URL 해시(서버로 전송되지 않음)의 토큰으로 supabase 세션을 확립(쿠키)하고
 * 목적지로 이동한다. 토큰은 즉시 해시에서 제거한다.
 *
 * 상태는 대기 → 성공 | 실패 셋이다. 시안의 "연결 중"은 해시 읽기가 동기라
 * 갈라지지 않는다(단계 표시로만 남긴다). 실패는 로그인 화면으로 보내되, 이동이
 * 막히는 WebView 를 위해 직접 누를 수 있는 링크도 남긴다.
 */
export default function NativeAuthPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [state, setState] = useState<"waiting" | "done" | "failed">("waiting");

  useEffect(() => {
    const raw = window.location.hash.replace(/^#/, "");
    const params = new URLSearchParams(raw);
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    const nextRaw = params.get("next") || "/dashboard";
    // 앱 내 상대경로만 허용 — "//evil.com"(프로토콜 상대)·백슬래시 우회로 오픈 리다이렉트 방지
    const next =
      /^\/(?!\/)/.test(nextRaw) && !nextRaw.includes("\\") ? nextRaw : "/dashboard";

    // 토큰 노출 최소화: 해시 즉시 제거
    history.replaceState(null, "", window.location.pathname);

    if (!access_token || !refresh_token) {
      router.replace("/login?error=native");
      return;
    }

    createClient()
      .auth.setSession({ access_token, refresh_token })
      .then(({ error }) => {
        if (error) {
          setState("failed");
          router.replace("/login?error=native");
        } else {
          setState("done");
          router.replace(next);
        }
      })
      .catch(() => {
        setState("failed");
        router.replace("/login?error=native");
      });
  }, [router]);

  const steps = [
    "auth.nativeStepLogin",
    "auth.nativeStepConnect",
    "auth.nativeStepDone",
  ] as const;
  // 완료된 단계: 대기 중엔 로그인(1) 만, 성공이면 전부
  const doneUpTo = state === "done" ? 3 : state === "waiting" ? 1 : 0;

  return (
    <div className="rx-public">
      <PublicHeader />
      <main className="rx-state-page">
        <section>
          <span className={"rx-state-icon " + (state === "failed" ? "warning" : "")}>
            <Monitor />
          </span>
          <span className="rx-kicker">NATIVE WEBVIEW</span>
          <h1>{t("auth.native")}</h1>
          <p>{t("auth.nativeIntro")}</p>
          <Panel>
            <h2 role="status">
              {state === "failed"
                ? t("auth.nativeFailed")
                : state === "done"
                  ? t("auth.nativeDone")
                  : t("auth.nativeWaiting")}
            </h2>
            <ol className="rx-native-steps">
              {steps.map((key, i) => (
                <li key={key}>
                  <span>{i < doneUpTo ? <Check size={16} /> : i + 1}</span>
                  {t(key)}
                </li>
              ))}
            </ol>
            {state === "failed" && (
              <Go href="/login" primary>
                {t("auth.nativeRetry")}
              </Go>
            )}
          </Panel>
        </section>
      </main>
    </div>
  );
}
