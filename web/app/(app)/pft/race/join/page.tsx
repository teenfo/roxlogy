import Link from "next/link";
import { getT } from "@/lib/i18n";
import { PftRaceJoinForm } from "@/components/pft-race-forms";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("pft.race.join") };
}

export default async function PftRaceJoinPage() {
  const { t } = await getT();
  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4">
      <div>
        <Link href="/pft" className="text-sm text-muted hover:text-foreground">← {t("pft.title")}</Link>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight">{t("pft.race.join")}</h1>
        <p className="mt-1 text-sm text-muted">{t("pft.race.joinPageDesc")}</p>
      </div>
      <PftRaceJoinForm />
    </main>
  );
}
