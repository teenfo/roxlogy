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

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, disabled")
    .eq("id", user.id)
    .maybeSingle();
  const isAdmin = profile?.is_admin === true;

  // 비활성(정지) 계정: 앱 접근 차단
  if (profile?.disabled) {
    return (
      <main className="mx-auto max-w-md px-6 py-24 text-center">
        <h1 className="text-xl font-bold">{t("suspended.title")}</h1>
        <p className="mt-2 text-sm text-muted">{t("suspended.body")}</p>
        <form action="/auth/signout" method="post" className="mt-6">
          <button type="submit" className="text-sm text-accent hover:underline">
            {t("common.logout")}
          </button>
        </form>
      </main>
    );
  }

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
            <Link href="/exercises" className="text-sm text-muted hover:text-foreground">
              {t("nav.exercises")}
            </Link>
            <Link href="/predict" className="text-sm text-muted hover:text-foreground">
              {t("nav.predict")}
            </Link>
            <Link href="/events" className="text-sm text-muted hover:text-foreground">
              {t("nav.events")}
            </Link>
          </div>

          {/* 데스크톱 우측 (프로필·로그아웃) */}
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
          <MobileNav isAdmin={isAdmin} />
        </nav>
      </header>
      <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        {children}
      </div>
    </>
  );
}
