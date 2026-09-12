import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCachedProfile, getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { PftRaceCreateForm } from "@/components/pft-race-forms";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("pft.race.create") };
}

/** 레이스 만들기 — 전체 관리자 또는 내가 운영진인 크루 */
export default async function PftRaceNewPage() {
  const [{ t }, user, profile] = await Promise.all([getT(), getCachedUser(), getCachedProfile()]);
  const supabase = await createClient();
  const { data: staffRows } = await supabase
    .from("crew_members")
    .select("crews ( slug, name )")
    .eq("user_id", user!.id)
    .eq("status", "active")
    .in("role", ["owner", "coach"]);
  type Row = { crews: { slug: string; name: string } | { slug: string; name: string }[] | null };
  const crews = ((staffRows ?? []) as unknown as Row[])
    .map((r) => (Array.isArray(r.crews) ? r.crews[0] : r.crews))
    .filter((c): c is { slug: string; name: string } => !!c);
  const allowed = !!profile?.is_admin || crews.length > 0;

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4">
      <div>
        <Link href="/pft" className="text-sm text-muted hover:text-foreground">← {t("pft.title")}</Link>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight">{t("pft.race.create")}</h1>
        <p className="mt-1 text-sm text-muted">{t("pft.race.createDesc")}</p>
      </div>
      {allowed ? (
        <PftRaceCreateForm crews={crews} />
      ) : (
        <p className="rounded-2xl border border-line bg-card p-5 text-sm text-muted">
          {t("pft.race.err.not_allowed")}
        </p>
      )}
    </main>
  );
}
