import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { DEFAULT_LOCALE } from "@/lib/i18n/config";
import { LocaleBoundary } from "@/components/locale-boundary";
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
  // 정적 셸이 되려면 여기서 쿠키를 읽으면 안 된다(cacheComponents/PPR). <html lang> 은
  // 기본 로케일로 내보내고, 실제 로케일이 정해지는 LocaleBoundary 에서 맞춰 준다.
  const locale = DEFAULT_LOCALE;
  return (
    <html lang={locale} className="h-full scroll-smooth antialiased">
      <body className="min-h-full flex flex-col">
        <TzSync />
        {/* 로케일(쿠키)은 Suspense 안에서 읽는다 — 셸은 정적으로 두고, 서버·클라이언트가
            처음부터 같은 사전을 보게 해 하이드레이션 불일치를 막는다. */}
        <Suspense>
          <LocaleBoundary>{children}</LocaleBoundary>
        </Suspense>
        {/* 실사용자 지표(LCP/TTFB/INP) 수집 — 개선 전후를 숫자로 비교하기 위해 */}
        <SpeedInsights />
      </body>
    </html>
  );
}
