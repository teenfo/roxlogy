import Image from "next/image";
import Link from "next/link";
import { getCachedProfile, getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { DesktopNav } from "@/components/desktop-nav";
import { MobileNav } from "@/components/mobile-nav";
import { SignOutForm } from "@/components/sign-out-form";
import { LocaleSwitcher } from "@/components/locale-switcher";

/**
 * 크루 페이지 공용 헤더 — 크루 라우트는 (app) 그룹 밖(비로그인 랜딩 겸용)이라
 * 앱 레이아웃 헤더가 안 붙는다. 로그인 상태면 앱 전체 내비를 그대로 보여주고,
 * 비로그인이면 최소 헤더(로고·언어·로그인)로 폴백한다.
 */
export async function CrewHeader({ loginNext }: { loginNext: string }) {
  const user = await getCachedUser();
  const [{ t }, profile] = await Promise.all([
    getT(),
    user ? getCachedProfile() : Promise.resolve(null),
  ]);

  if (!user) {
    return (
      <header className="sticky top-0 z-40 border-b border-surface bg-background">
        <nav className="mx-auto flex max-w-4xl items-center gap-4 px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/roxlogy-mark.svg" alt="" width={24} height={24} />
            <span className="text-xs font-black tracking-widest text-muted">
              ROXLOGY
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-4">
            <LocaleSwitcher />
            <Link
              href={`/login?next=${loginNext}`}
              className="text-sm text-muted hover:text-foreground"
            >
              {t("common.login")}
            </Link>
          </div>
        </nav>
      </header>
    );
  }

  const isAdmin = profile?.is_admin === true;
  return (
    <header className="sticky top-0 z-40 border-b border-surface bg-background">
      <nav className="mx-auto flex max-w-4xl items-center gap-6 px-6 py-4">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <Image src="/roxlogy-mark.svg" alt="" width={28} height={28} />
          <span className="text-sm font-black tracking-widest">ROXLOGY</span>
        </Link>
        <DesktopNav />
        <div className="ml-auto hidden items-center gap-4 sm:flex">
          {isAdmin && (
            <Link
              href="/admin"
              className="text-sm font-semibold text-accent hover:brightness-110"
            >
              {t("nav.admin")}
            </Link>
          )}
          <Link
            href="/settings/profile"
            className="text-sm text-muted hover:text-foreground"
          >
            {t("nav.profile")}
          </Link>
          <SignOutForm
            buttonClassName="text-sm text-muted hover:text-foreground"
            label={t("common.logout")}
          />
        </div>
        <MobileNav isAdmin={isAdmin} />
      </nav>
    </header>
  );
}
