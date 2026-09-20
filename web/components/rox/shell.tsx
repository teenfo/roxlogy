import type { ReactNode } from "react";
import { getShellData } from "@/lib/shell";
import { GoogleOneTap } from "@/components/google-one-tap";
import { AppShell } from "./app-shell";
import { PublicHeader } from "./public-header";

/**
 * 로그인 여부에 따라 앱 셸(사이드바·상단바) 또는 공개 헤더를 두르는 서버 컴포넌트.
 * (app) 레이아웃과, (app) 밖에 있는 공개 겸용 라우트(크루·대회·계산기)가 같이 쓴다.
 * 시안 rox-app.tsx 가 경로로 갈랐던 것을 우리는 세션으로 가른다(PORT_PLAN §2).
 */
export async function Shell({
  children,
  loginNext,
}: {
  children: ReactNode;
  /** 비로그인일 때 로그인 후 돌아올 곳 — One Tap 도 같은 곳으로 */
  loginNext?: string;
}) {
  const shell = await getShellData();
  if (!shell.user) {
    return (
      <div className="rx-public">
        <PublicHeader loginNext={loginNext} />
        <main id="main-content" tabIndex={-1} className="rx-main">
          {children}
        </main>
        {/* 공유 링크로 들어온 방문자가 페이지를 떠나지 않고 들어오게 (정책: 확정 4) */}
        {loginNext && <GoogleOneTap next={loginNext} />}
      </div>
    );
  }
  return (
    <AppShell
      displayName={shell.displayName}
      crew={shell.crew}
      unread={shell.unread}
    >
      {children}
    </AppShell>
  );
}
