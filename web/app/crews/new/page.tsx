import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { Shell } from "@/components/rox/shell";
import { CrewCreateForm } from "@/components/crew-create-form";
import { Empty, Go, PageHead } from "@/components/rox/ui";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("crew.createTitle")} — Roxlogy` };
}

/** 크루 만들기 — 시안 crew.tsx Crews({create}) 그대로: PageHead + form[Panel 크루 기본 정보]. */
export default async function CrewNewPage() {
  const [user, { t }] = await Promise.all([getCachedUser(), getT()]);

  return (
    <Shell loginNext="/crews/new">
      <PageHead title={t("crew.createHero")} description={t("crew.createHeroDesc")} />
      {user ? (
        <CrewCreateForm />
      ) : (
        <Empty
          title={t("common.needLogin")}
          description={t("crew.guestNote")}
          action={
            <Go href="/login?next=/crews/new" primary>
              {t("common.login")}
            </Go>
          }
        />
      )}
    </Shell>
  );
}
