"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * 브라우저 시간대를 tz 쿠키에 심어 서버 렌더 날짜가 사용자 시간대로 표시되게 한다.
 * 쿠키가 없거나 달라졌으면 저장 후 refresh — 최초 방문에서도 UTC 표시가 즉시 교정된다.
 */
export function TzSync() {
  const router = useRouter();
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!tz) return;
      const cur = document.cookie.match(/(?:^|; )tz=([^;]*)/)?.[1];
      if (cur !== encodeURIComponent(tz)) {
        document.cookie = `tz=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;
        router.refresh();
      }
    } catch {
      // Intl 미지원 환경 — UTC 폴백 유지
    }
  }, [router]);
  return null;
}
