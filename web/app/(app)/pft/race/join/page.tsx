import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { PftRacePick, type JoinableRace } from "@/components/pft-race-pick";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("pft.race.join") };
}

/** 레이스 참가 — 참가 가능한 레이스를 먼저 보여 주고 고르게 한다. 코드 입력은 보조 수단. */
export default async function PftRaceJoinPage() {
  const { t, tag, tz } = await getT();
  const supabase = await createClient();
  // supabase-js 는 실패해도 throw 하지 않는다 — 빈 목록으로 보이면 "레이스가 없다"로 읽힌다
  const { data, error } = await supabase.rpc("pft_race_joinable");
  const races = (Array.isArray(data) ? (data as JoinableRace[]) : []) ?? [];

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4">
      <div>
        <Link href="/pft" className="text-sm text-muted hover:text-foreground">
          ← {t("pft.title")}
        </Link>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight">{t("pft.race.join")}</h1>
        <p className="mt-1 text-sm text-muted">{t("pft.race.joinPageDesc")}</p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {t("pft.race.listError")}
        </p>
      )}
      <PftRacePick races={races} locale={tag} tz={tz} />
    </main>
  );
}
