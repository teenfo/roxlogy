"use client";

/**
 * 비로그인 화면의 상단 — 시안 public-screens.tsx 의 PublicHeader 그대로.
 * 브랜드 · 언어 · 로그인 · 회원가입 CTA. 브랜드는 링 마크 img (PORT_PLAN §1-b).
 */
import Image from "next/image";
import Link from "next/link";
import { useI18n } from "@/components/i18n-provider";
import { LocaleSwitcher } from "@/components/locale-switcher";

export function PublicHeader({ loginNext }: { loginNext?: string }) {
  const { t } = useI18n();
  const q = loginNext ? `?next=${encodeURIComponent(loginNext)}` : "";
  return (
    <header className="rx-public-header">
      <Link href="/" className="rx-public-brand">
        <Image src="/roxlogy-appicon.svg" alt="" width={34} height={34} />
        ROXLOGY
      </Link>
      <nav>
        <LocaleSwitcher className="rx-locale" />
        <Link href={`/login${q}`}>{t("common.login")}</Link>
        <Link className="rx-public-cta" href={`/signup${q}`}>
          {t("common.signup")}
        </Link>
      </nav>
    </header>
  );
}
