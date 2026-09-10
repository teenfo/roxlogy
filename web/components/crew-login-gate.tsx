import Link from "next/link";
import { getT } from "@/lib/i18n";
import { Card } from "@/components/ui/crew-ui";

/**
 * 로그인해야 볼 수 있는 크루 탭(멤버·리더보드)의 안내 카드.
 * 목록·소개·게시판은 공유 링크로 열어두지만, 사람 목록과 기록 순위는
 * 실명·디비전·기록이 그대로라 익명 방문자에게 보이지 않는다.
 * DB 쪽(crew_roster·crew_leaderboard)에서도 같은 조건으로 막혀 있다.
 */
export async function CrewLoginGate({ next }: { next: string }) {
  const { t } = await getT();
  return (
    <Card className="px-6 py-12 text-center">
      <p className="text-sm leading-relaxed text-muted [word-break:keep-all]">
        {t("crew.loginToSee")}
      </p>
      <Link
        href={`/login?next=${encodeURIComponent(next)}`}
        className="mt-5 inline-flex h-10 items-center rounded-full bg-accent px-5 text-sm font-extrabold text-background transition hover:brightness-110"
      >
        {t("common.login")}
      </Link>
    </Card>
  );
}
