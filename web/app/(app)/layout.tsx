import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedProfile, getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { AppSidebar } from "@/components/app-sidebar";
import { GlobalNav } from "@/components/global-nav";
import { MobileTabBar } from "@/components/mobile-tabbar";
import { SignOutForm } from "@/components/sign-out-form";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getCachedUser();
  if (!user) redirect("/login");
  // 프로필은 대시보드·설정 등 페이지와 같은 요청 안에서 공유된다 (왕복 1회)
  const [{ t }, profile] = await Promise.all([getT(), getCachedProfile()]);
  const isAdmin = profile?.is_admin === true;

  // 비활성(정지) 계정: 앱 접근 차단
  if (profile?.disabled) {
    return (
      <main className="mx-auto max-w-md px-6 py-24 text-center">
        <h1 className="text-[30px] font-extrabold leading-[1.4] tracking-[-1px] max-[1000px]:text-[27px] max-[600px]:text-[25px]">{t("suspended.title")}</h1>
        <p className="mt-2 text-sm text-muted">{t("suspended.body")}</p>
        <SignOutForm
          className="mt-6"
          buttonClassName="text-sm text-gold hover:underline"
          label={t("common.logout")}
        />
      </main>
    );
  }

  // 미확인 알림 — 네비의 빨간 점. head:true 라 행을 실어 나르지 않는다.
  const supabase = await createClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("read_at", null);

  // 스펙 §04 의 셸: 좌측 고정 사이드바 248px + 상단바 74px + 본문 최대 1600px.
  // 사이드바는 md 미만에서 사라지고 그 자리를 하단 탭바가 맡는다(스펙 §15).
  return (
    <div className="flex min-h-dvh flex-1 flex-col md:pl-[248px]">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 border-b border-line bg-nav">
          <GlobalNav
            isAdmin={isAdmin}
            displayName={profile?.display_name ?? "Athlete"}
            unread={count ?? 0}
            withSidebar
          />
        </header>
        {/* 하단 탭바(모바일)에 가리지 않도록 아래 여백을 준다 */}
        <div className="mx-auto w-full max-w-[1600px] flex-1 px-9 py-8 max-[1200px]:px-6 max-md:px-4 max-md:pb-28">
          {children}
        </div>
      </div>
      <MobileTabBar />
    </div>
  );
}
