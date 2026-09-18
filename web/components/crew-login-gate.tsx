import { getT } from "@/lib/i18n";
import { AccessGate } from "@/components/ui/access-gate";

/**
 * 로그인해야 볼 수 있는 크루 탭(멤버·리더보드)의 안내 카드.
 * 목록·소개·게시판은 공유 링크로 열어두지만, 사람 목록과 기록 순위는
 * 실명·디비전·기록이 그대로라 익명 방문자에게 보이지 않는다.
 * DB 쪽(crew_roster·crew_leaderboard)에서도 같은 조건으로 막혀 있다.
 */
export async function CrewLoginGate({ next }: { next: string }) {
  const { t } = await getT();
  return (
    <AccessGate
      title={t("common.login")}
      reason={t("crew.loginToSee")}
      action={{
        href: `/login?next=${encodeURIComponent(next)}`,
        label: t("common.login"),
      }}
    />
  );
}
