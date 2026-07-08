import type { Metadata, Viewport } from "next";
import { getDict, getT } from "@/lib/i18n";
import { I18nProvider } from "@/components/i18n-provider";
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { locale } = await getT();
  return (
    <html lang={locale} className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <I18nProvider locale={locale} dict={getDict(locale)}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
