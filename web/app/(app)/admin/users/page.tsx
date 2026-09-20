import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { formatDateShort } from "@/lib/format";
import { AdminUserActions } from "@/components/admin-user-actions";
import { QueryFind } from "@/components/rox/query-filters";
import { Chip, DataTable, Empty, Hint, Panel } from "@/components/rox/ui";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("admin.tabUsers") };
}

type AdminUser = {
  id: string;
  display_name: string | null;
  email: string | null;
  created_at: string;
  is_admin: boolean;
  disabled: boolean;
  leaderboard_opt_in: boolean;
  session_count: number;
};

/** 사용자 관리 — 시안 Admin(users): Panel 사용자 목록[ Find · DataTable[사용자 · 상태 · 권한 · 세션] · Hint ]. 가입일·토글 버튼은 우리 열(§4). */
export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const supabase = await createClient();
  const { t, tag, tz } = await getT();

  const { data } = await supabase.rpc("admin_users", { p_search: q ?? null });
  const users = (data ?? []) as AdminUser[];

  return (
    <Panel title={t("admin.userList")}>
      <QueryFind param="q" value={q ?? ""} placeholder={t("admin.searchName")} />
      {users.length ? (
        <DataTable
          headers={[t("admin.colUser"), t("admin.colStatus"), t("admin.colRole"), t("admin.colJoined"), t("admin.colSessions"), ""]}
          rows={users.map((u) => [
            <span key="u">
              <Link href={`/admin/users/${u.id}`}>
                <b>{u.display_name ?? t("admin.noName")}</b>
              </Link>
              <small className="rx-muted" style={{ display: "block" }}>
                {u.email ?? u.id.slice(0, 8)}
              </small>
            </span>,
            <span key="s" className="rx-actions" style={{ marginTop: 0, flexWrap: "nowrap" }}>
              <Chip tone={u.disabled ? "red" : "green"}>{u.disabled ? t("admin.flagDisabled") : t("admin.statusActive")}</Chip>
              {u.leaderboard_opt_in && <Chip tone="blue">LB</Chip>}
            </span>,
            u.is_admin ? <Chip key="r" tone="yellow">{t("admin.roleAdmin")}</Chip> : <span key="r">{t("admin.roleUser")}</span>,
            formatDateShort(u.created_at, tag, tz),
            <span key="n" className="rx-number">
              {u.session_count}
            </span>,
            <AdminUserActions key="a" userId={u.id} isAdmin={u.is_admin} disabled={u.disabled} />,
          ])}
        />
      ) : (
        <Empty title={t("admin.noUsers")} description={t("admin.searchName")} />
      )}
      <Hint>{t("admin.editHint")}</Hint>
    </Panel>
  );
}
