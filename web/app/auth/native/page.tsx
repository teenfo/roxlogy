"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * 네이티브 앱 → 웹 자동 로그인 핸드셰이크.
 * 네이티브 WebView가 `/auth/native#access_token=..&refresh_token=..&next=/dashboard` 로 진입하면
 * URL 해시(서버로 전송되지 않음)의 토큰으로 supabase 세션을 확립(쿠키)하고 목적지로 이동한다.
 * 토큰은 즉시 해시에서 제거한다.
 */
export default function NativeAuthPage() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const raw = window.location.hash.replace(/^#/, "");
    const params = new URLSearchParams(raw);
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    const nextRaw = params.get("next") || "/dashboard";
    const next = nextRaw.startsWith("/") ? nextRaw : "/dashboard";

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
          setFailed(true);
          router.replace("/login?error=native");
        } else {
          router.replace(next);
        }
      })
      .catch(() => {
        setFailed(true);
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
        background: "#141414",
        color: "#F4F4F2",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <p style={{ fontSize: 14, color: "#9A9A96" }}>
        {failed ? "로그인 처리에 실패했습니다. 다시 시도해 주세요." : "로그인 중…"}
      </p>
    </div>
  );
}
