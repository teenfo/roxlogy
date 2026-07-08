import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { MobileNav } from "@/components/mobile-nav";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { t } = await getT();

  return (
    <>
      <header className="border-b border-surface">
        <nav className="mx-auto flex max-w-4xl items-center gap-6 px-6 py-4">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <Image src="/roxlogy-mark.svg" alt="" width={28} height={28} />
            <span className="text-sm font-black tracking-widest">ROXLOGY</span>
          </Link>

          {/* 데스크톱 내비 */}
          <div className="hidden items-center gap-6 sm:flex">
            <Link href="/sessions" className="text-sm text-muted hover:text-foreground">
              {t("nav.sessions")}
            </Link>
            <Link href="/races" className="text-sm text-muted hover:text-foreground">
              {t("nav.races")}
            </Link>
            <Link href="/programs" className="text-sm text-muted hover:text-foreground">
              {t("nav.programs")}
            </Link>
            <Link href="/schedule" className="text-sm text-muted hover:text-foreground">
              {t("nav.schedule")}
            </Link>
            <Link href="/leaderboard" className="text-sm text-muted hover:text-foreground">
              {t("nav.leaderboard")}
            </Link>
            <Link href="/feed" className="text-sm text-muted hover:text-foreground">
              {t("nav.feed")}
            </Link>
            <Link href="/events" className="text-sm text-muted hover:text-foreground">
              {t("nav.events")}
            </Link>
            <Link href="/exercises" className="text-sm text-muted hover:text-foreground">
              {t("nav.exercises")}
            </Link>
          </div>

          {/* 데스크톱 우측 (프로필·로그아웃) */}
          <div className="ml-auto hidden items-center gap-4 sm:flex">
            <Link
              href="/settings/profile"
              className="text-sm text-muted hover:text-foreground"
            >
              {t("nav.profile")}
            </Link>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="text-sm text-muted hover:text-foreground"
              >
                {t("common.logout")}
              </button>
            </form>
          </div>

          {/* 모바일 햄버거 메뉴 */}
          <MobileNav />
        </nav>
      </header>
      <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        {children}
      </div>
    </>
  );
}
