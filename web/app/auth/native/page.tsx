"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

/**
 * 네이티브 앱 → 웹 자동 로그인 핸드셰이크.
 * 네이티브 WebView가 `/auth/native#access_token=..&refresh_token=..&next=/dashboard` 로 진입하면
 * URL 해시(서버로 전송되지 않음)의 토큰으로 supabase 세션을 확립(쿠키)하고 목적지로 이동한다.
 * 토큰은 즉시 해시에서 제거한다.
 */
export default function NativeAuthPage() {
  const router = useRouter();
  const { t } = useI18n();
  /**
   * 화면 상태 — 대기 → 성공 | 실패.
   *
   * 스펙 §18 은 대기·연결·성공·실패 4상태를 그리지만, 실제 흐름에서 "대기"와
   * "연결"은 갈라지지 않는다: 해시에서 토큰을 읽는 건 동기라 한 프레임도 안 걸리고,
   * 그 뒤는 곧바로 setSession 이다. 억지로 나누려면 없는 지연을 만들어야 해서
   * 관측 가능한 3상태만 둔다. 실패는 로그인 화면으로 보내되, 이동이 막히는
   * WebView 를 위해 직접 누를 수 있는 링크도 남긴다.
   */
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

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--background)",
        color: "var(--foreground)",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: 24, textAlign: "center" }}>
        {/* 진행 중에는 도는 표시를, 끝나면 멈춘 표시를 둔다 */}
        <span
          aria-hidden
          className={state === "failed" ? "" : "motion-safe:animate-pulse"}
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background:
              state === "failed"
                ? "var(--danger)"
                : state === "done"
                  ? "var(--income)"
                  : "var(--accent)",
          }}
        />
        <p role="status" style={{ fontSize: 14, color: "var(--muted)", margin: 0 }}>
          {state === "failed"
            ? t("auth.nativeFailed")
            : state === "done"
              ? t("auth.nativeDone")
                : t("auth.nativeWaiting")}
        </p>
        {state === "failed" && (
          <a
            href="/login"
            style={{
              marginTop: 4,
              height: 44,
              display: "inline-flex",
              alignItems: "center",
              padding: "0 18px",
              borderRadius: 10,
              background: "var(--accent)",
              color: "var(--accent-foreground)",
              fontSize: 14,
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            {t("auth.nativeRetry")}
          </a>
        )}
      </div>
    </div>
  );
}
