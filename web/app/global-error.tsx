"use client";

import { useEffect } from "react";

/**
 * 루트 레이아웃이 통째로 실패했을 때의 마지막 화면 (스펙 §18).
 *
 * 이 경계는 `<html>`·`<body>` 를 **스스로 그려야 한다** — 루트 레이아웃이
 * 렌더되지 않은 상태라서다. 그 말은 i18n Provider 도, globals.css 의 토큰이
 * 적용된 트리도 없다는 뜻이라, 여기서만 예외적으로 값을 인라인으로 박는다.
 * 문구는 브라우저 언어를 보고 고른다(사전을 불러올 수 없다).
 */
const COPY: Record<string, { title: string; desc: string; retry: string }> = {
  ko: {
    title: "문제가 생겼습니다",
    desc: "페이지를 새로고침해 주세요. 계속되면 잠시 뒤에 다시 시도해 주세요.",
    retry: "다시 시도",
  },
  en: {
    title: "Something went wrong",
    desc: "Please reload the page. If it keeps happening, try again shortly.",
    retry: "Try again",
  },
  es: {
    title: "Algo salió mal",
    desc: "Recarga la página. Si continúa, inténtalo de nuevo en unos minutos.",
    retry: "Reintentar",
  },
};

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("global error", error);
  }, [error]);

  const lang =
    typeof navigator !== "undefined"
      ? (navigator.language ?? "en").slice(0, 2)
      : "en";
  const c = COPY[lang] ?? COPY.en;

  return (
    <html lang={lang}>
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: 24,
          textAlign: "center",
          background: "#f5f6f8",
          color: "#25282d",
          fontFamily:
            '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Segoe UI", sans-serif',
        }}
      >
        {/* 마크는 자기 바탕이 있는 앱 아이콘을 쓴다 — 투명 마크는 흰 배경에서 사라진다 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/roxlogy-appicon.svg" alt="" width={64} height={64} />
        <h1 style={{ fontSize: 25, fontWeight: 800, letterSpacing: "-1px", margin: 0 }}>
          {c.title}
        </h1>
        <p style={{ fontSize: 14, color: "#69727f", margin: 0, maxWidth: 420 }}>
          {c.desc}
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            height: 48,
            padding: "0 20px",
            borderRadius: 10,
            border: "none",
            background: "#ffd500",
            color: "#252b31",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {c.retry}
        </button>
        {error.digest && (
          <p style={{ fontSize: 12, color: "#6f7783", margin: 0 }}>{error.digest}</p>
        )}
      </body>
    </html>
  );
}
