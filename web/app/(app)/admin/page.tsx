import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { Panel, RecordRow, Stats } from "@/components/rox/ui";

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

/** 운영 현황 — 시안 Admin(개요): Stats 4 · two-col[Panel 운영 바로가기 · Panel 확인할 데이터]. */
export default async function AdminOverviewPage() {
  const supabase = await createClient();
  const { t } = await getT();
  const { data } = await supabase.rpc("admin_overview");
  const o = (data ?? null) as Partial<Overview> | null;
  // RPC 가 열을 빼먹어도 "undefined" 가 화면에 찍히지 않게
  const n = (v: number | undefined) => String(v ?? 0);

  return (
    <>
      {o && (
        <Stats
          items={[
            [t("admin.mUsers"), n(o.users), t("admin.mNew7d", { n: o.new_users_7d ?? 0 })],
            [t("admin.mSessions"), n(o.sessions), t("admin.mNew7d", { n: o.sessions_7d ?? 0 })],
            [t("admin.mRaces"), n(o.races), t("admin.racesDesc")],
            [t("admin.mPrograms"), n(o.programs), t("admin.mPublic", { n: o.public_programs ?? 0 })],
          ]}
        />
      )}
      <div className="rx-two-col">
        <Panel title={t("admin.quickLinks")}>
          <RecordRow href="/admin/users" title={t("admin.usersTitle")} note={o ? `${t("admin.mAdmins")} ${n(o.admins)} · ${t("admin.mDisabled")} ${n(o.disabled)}` : undefined} />
          <RecordRow href="/admin/crews" title={t("admin.crewsTitle")} note={t("admin.crewsPending")} />
          <RecordRow href="/admin/content" title={t("admin.exercisesTitle")} note={t("admin.exReqTitle")} />
        </Panel>
        <Panel title={t("admin.checkData")}>
          <RecordRow href="/admin/moderation" title={t("admin.modTitle")} note={t("admin.modDesc")} />
          <RecordRow href="/admin/races" title={t("admin.racesTitle")} note={t("admin.racesDesc")} />
        </Panel>
      </div>
    </>
  );
}
