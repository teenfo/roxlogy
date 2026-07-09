import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("admin.tabOverview") };
}

type Overview = {
  users: number;
  admins: number;
  disabled: number;
  sessions: number;
  races: number;
  programs: number;
  public_programs: number;
  new_users_7d: number;
  sessions_7d: number;
};

export default async function AdminOverviewPage() {
  const supabase = await createClient();
  const { t } = await getT();
  const { data } = await supabase.rpc("admin_overview");
  const o = (data ?? null) as Overview | null;

  const cards: { label: string; value: number; sub?: string }[] = o
    ? [
        { label: t("admin.mUsers"), value: o.users, sub: t("admin.mNew7d", { n: o.new_users_7d }) },
        { label: t("admin.mSessions"), value: o.sessions, sub: t("admin.mNew7d", { n: o.sessions_7d }) },
        { label: t("admin.mRaces"), value: o.races },
        { label: t("admin.mPrograms"), value: o.programs, sub: t("admin.mPublic", { n: o.public_programs }) },
        { label: t("admin.mAdmins"), value: o.admins },
        { label: t("admin.mDisabled"), value: o.disabled },
      ]
    : [];

  return (
    <main>
      <h1 className="text-xl font-bold">{t("admin.overviewTitle")}</h1>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-md bg-surface px-4 py-4">
            <p className="text-xs text-muted">{c.label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{c.value}</p>
            {c.sub && <p className="mt-0.5 text-xs text-track">{c.sub}</p>}
          </div>
        ))}
      </div>
    </main>
  );
}
