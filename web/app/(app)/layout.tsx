import { redirect } from "next/navigation";
import { getCachedProfile, getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { AccessGate } from "@/components/ui/access-gate";
import { Shell } from "@/components/rox/shell";
import { SignOutForm } from "@/components/sign-out-form";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getCachedUser();
  if (!user) redirect("/login");
  // 프로필은 대시보드·설정 등 페이지와 같은 요청 안에서 공유된다 (왕복 1회)
  const [{ t }, profile] = await Promise.all([getT(), getCachedProfile()]);

  // 비활성(정지) 계정: 앱 접근 차단
  if (profile?.disabled) {
    return (
      <div className="rx-public">
        <AccessGate
          tone="alert"
          title={t("suspended.title")}
          reason={t("suspended.body")}
        />
        <SignOutForm
          className="text-center"
          buttonClassName="rx-auth-link"
          label={t("common.logout")}
        />
      </div>
    );
  }

  // 시안 셸(PORT_PLAN §2): 사이드바 15.5rem + 상단바 + .rx-main + 푸터 + 모바일 탭.
  // 프로필·알림 수·내 크루는 Shell 안의 getShellData 가 한 번에 받는다.
  return <Shell>{children}</Shell>;
}
