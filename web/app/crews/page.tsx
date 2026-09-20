import Link from "next/link";
import { Plus } from "lucide-react";
import { getCrewDirectory, getMyCrews } from "@/lib/crew";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { Shell } from "@/components/rox/shell";
import { CrewFinder } from "@/components/crew-finder";
import { Empty, Go, Hint, PageHead } from "@/components/rox/ui";

export async function generateMetadata() {
  const { t } = await getT();
  return {
    title: `${t("crew.directoryTitle")} — Roxlogy`,
    description: t("crew.directorySub"),
  };
}

/**
 * 크루 찾기 — 시안 crew.tsx Crews() 그대로 (PORT_PLAN §3-e):
 * PageHead("함께여서, 더 멀리." + Go 크루 만들기) · Panel[Find] · .rx-crew-discover 카드 · Empty.
 * 내 크루는 "가입한 크루" 칩이 붙은 카드로 앞에 온다(CrewFinder). 비로그인 안내는 Hint 로(§4).
 */
export default async function CrewDirectoryPage() {
  const [crews, mine, user, { t }] = await Promise.all([
    getCrewDirectory(),
    getMyCrews(),
    getCachedUser(),
    getT(),
  ]);

  return (
    <Shell loginNext="/crews">
      <PageHead
        title={t("crew.directoryHero")}
        description={t("crew.directoryHeroDesc")}
        action={
          <Go href={user ? "/crews/new" : "/login?next=%2Fcrews%2Fnew"}>
            <Plus size={16} />
            {t("crew.createCta")}
          </Go>
        }
      />
      {/* 비로그인 안내 — 목록·소개는 그냥 보이고, 가입·일정만 로그인이 필요하다 */}
      {!user && (
        <Hint>
          {t("crew.guestNote")} <Link href="/login?next=%2Fcrews">{t("common.login")} →</Link>
        </Hint>
      )}
      {!crews.length ? (
        <Empty title={t("crew.directoryEmpty")} description={t("crew.directorySub")} />
      ) : (
        <CrewFinder crews={crews} mine={mine} loggedIn={!!user} />
      )}
    </Shell>
  );
}
