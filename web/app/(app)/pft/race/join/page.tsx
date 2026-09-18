import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { PftRacePick, type JoinableRace } from "@/components/pft-race-pick";
import { ProfileRequired, missingForRace } from "@/components/profile-required";
import { getCachedUser } from "@/lib/supabase/auth";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("pft.race.join") };
}

/** 레이스 참가 — 참가 가능한 레이스를 먼저 보여 주고 고르게 한다. 코드 입력은 보조 수단. */
export default async function PftRaceJoinPage() {
  const { t, tag, tz } = await getT();
  const supabase = await createClient();
  // supabase-js 는 실패해도 throw 하지 않는다 — 빈 목록으로 보이면 "레이스가 없다"로 읽힌다
  const user = await getCachedUser();
  const [{ data, error }, { data: me }] = await Promise.all([
    supabase.rpc("pft_race_joinable"),
    supabase.from("profiles").select("birth_year, gender").eq("id", user!.id).maybeSingle(),
  ]);
  const races = (Array.isArray(data) ? (data as JoinableRace[]) : []) ?? [];
  // 배지·순위가 나이·성별로 갈린다 — 비어 있으면 참가를 막고 프로필로 보낸다
  const missing = missingForRace(me as { birth_year: number | null; gender: string | null } | null);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4">
      <div>
        <Link href="/pft" className="text-sm text-muted hover:text-foreground">
          ← {t("pft.title")}
        </Link>
        <h1 className="mt-2 text-[30px] font-extrabold leading-[1.4] tracking-[-1px] max-[1000px]:text-[27px] max-[600px]:text-[25px]">{t("pft.race.join")}</h1>
        <p className="mt-1 text-sm text-muted">{t("pft.race.joinPageDesc")}</p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {t("pft.race.listError")}
        </p>
      )}
      <ProfileRequired missing={missing} />
      <PftRacePick races={races} locale={tag} tz={tz} blocked={missing.length > 0} />
    </main>
  );
}
