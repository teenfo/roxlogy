import type { Metadata, Viewport } from "next";
import { getDict } from "@/lib/i18n";
import { Suspense } from "react";
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
  // 스파이크: 쿠키를 읽지 않는다 — 정적 셸이 만들어지는지 보기 위해
  const locale = DEFAULT_LOCALE;
  return (
    <html lang={locale} className="h-full scroll-smooth antialiased">
      <body className="min-h-full flex flex-col">
        <I18nProvider locale={locale} dict={getDict(locale)}>
          <TzSync />
          <Suspense>{children}</Suspense>
          {/* 실사용자 지표(LCP/TTFB/INP) 수집 — 개선 전후를 숫자로 비교하기 위해 */}
          <SpeedInsights />
        </I18nProvider>
      </body>
    </html>
  );
}
