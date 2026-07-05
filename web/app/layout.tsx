import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Roxlogy",
  description: "하이브리드 레이스를 데이터로 연구하다",
  icons: { icon: "/roxlogy-appicon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
