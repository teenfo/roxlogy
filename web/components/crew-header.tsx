import { createClient } from "@/lib/supabase/server";
import { getCachedProfile, getCachedUser } from "@/lib/supabase/auth";
import { GlobalNav } from "@/components/global-nav";
import { MobileTabBar } from "@/components/mobile-tabbar";

/**
 * 크루 페이지 공용 헤더 — 크루 라우트는 (app) 그룹 밖(비로그인 랜딩 겸용)이라
 * 앱 레이아웃 헤더가 안 붙는다. 앱과 같은 글로벌 네비를 쓰되, 비로그인이면
 * GlobalNav 가 알림·아바타 대신 로그인 버튼을 보여준다.
 */
export async function CrewHeader({ loginNext }: { loginNext: string }) {
  const user = await getCachedUser();
  const profile = user ? await getCachedProfile() : null;

  let unread = 0;
  if (user) {
    const supabase = await createClient();
    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null);
    unread = count ?? 0;
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line-soft bg-[var(--nav)]">
        <GlobalNav
          isAdmin={profile?.is_admin === true}
          displayName={user ? (profile?.display_name ?? "Athlete") : null}
          unread={unread}
          loginNext={loginNext}
        />
      </header>
      {/* 하단 탭바는 로그인 상태에서만 — 비로그인은 갈 수 없는 탭들이다 */}
      {user && <MobileTabBar />}
    </>
  );
}
