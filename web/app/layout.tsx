import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { getDict } from "@/lib/i18n";
import { DEFAULT_LOCALE } from "@/lib/i18n/config";
import { I18nProvider } from "@/components/i18n-provider";
import { TzSync } from "@/components/tz-sync";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Roxlogy",
  description: "The science of hybrid racing",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/roxlogy-appicon.svg",
    apple: "/roxlogy-appicon.svg",
  },
  appleWebApp: {
    capable: true,
    title: "Roxlogy",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#141414",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 정적 셸이 되려면 여기서 쿠키를 읽으면 안 된다(cacheComponents/PPR) — 기본 로케일로
  // 내보내고 사용자의 실제 언어는 I18nProvider 가 브라우저에서 보정한다.
  // 서버 컴포넌트의 텍스트는 각 페이지의 getT() 가 여전히 쿠키로 결정한다.
  const locale = DEFAULT_LOCALE;
  return (
    <html lang={locale} className="h-full scroll-smooth antialiased">
      <body className="min-h-full flex flex-col">
        <I18nProvider locale={locale} dict={getDict(locale)}>
          <TzSync />
          {/* 페이지의 동적 부분이 스트리밍되도록 — 셸은 즉시 엣지에서 나간다 */}
          <Suspense>{children}</Suspense>
          {/* 실사용자 지표(LCP/TTFB/INP) 수집 — 개선 전후를 숫자로 비교하기 위해 */}
          <SpeedInsights />
        </I18nProvider>
      </body>
    </html>
  );
}
