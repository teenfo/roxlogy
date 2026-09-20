import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { formatDate, formatDateShort } from "@/lib/format";
import { dictLabel } from "@/lib/dict-label";
import { AdminUserEdit, type AdminUserDetail } from "@/components/admin-user-edit";
import { Back, Chip, DataTable, Empty, Go, Panel, RecordRow, Stats } from "@/components/rox/ui";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("admin.userDetail") };
}

/** 사용자 상세 — 시안 Admin(사용자 상세) 자리: Back · .rx-subhead(이름 · 칩 · Go 공개 프로필) · Panel 계정(DataTable) · Stats · Panel 크루 · Panel 수정. */
export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t, tag, tz } = await getT();
  const supabase = await createClient();

  // 관리자가 아니면 RPC 가 null 을 돌려준다 (레이아웃에서도 이미 막지만 이중으로)
  const { data } = await supabase.rpc("admin_user_detail", { p_user: id });
  if (!data) notFound();
  const u = data as AdminUserDetail;

  return (
    <>
      <Back href="/admin/users" label={t("admin.tabUsers")} />
      <div className="rx-subhead">
        <h2>
          {u.display_name ?? t("admin.noName")}{" "}
          {u.is_admin && <Chip tone="yellow">{t("admin.roleAdmin")}</Chip>} {u.disabled && <Chip tone="red">{t("admin.flagDisabled")}</Chip>}{" "}
          {u.leaderboard_opt_in && <Chip tone="blue">LB</Chip>}
        </h2>
        <Go href={`/u/${u.id}`}>{t("admin.viewPublic")}</Go>
      </div>

      <Stats
        items={[
          [t("admin.colSessions"), String(u.session_count), u.last_session_at ? `${t("admin.lastSession")} ${formatDateShort(u.last_session_at, tag, tz)}` : "—"],
          [t("nav.races"), String(u.race_count), ""],
          ["PFT", String(u.pft_count), ""],
          [t("nav.programs"), String(u.program_count), ""],
        ]}
      />

      <div className="rx-two-col">
        <Panel title={t("admin.secAccount")}>
          <DataTable
            headers={[t("admin.colItem"), t("admin.colValue")]}
            rows={[
              ["Email", u.email ?? "—"],
              ["User ID", <code key="id">{u.id}</code>],
              [t("admin.colJoined"), formatDate(u.created_at, tag, tz)],
              [t("admin.lastSignIn"), u.last_sign_in_at ? formatDate(u.last_sign_in_at, tag, tz) : "—"],
              [t("admin.emailConfirmed"), u.email_confirmed_at ? formatDateShort(u.email_confirmed_at, tag, tz) : t("admin.notConfirmed")],
              [t("admin.mcpToken"), `${u.has_mcp_token ? t("admin.tokenIssued") : t("admin.tokenNone")} · ${t("admin.tokenHidden")}`],
            ]}
          />
        </Panel>
        <Panel title={t("admin.secCrews")}>
          {!u.crews.length ? (
            <Empty title="—" description={t("admin.secCrews")} />
          ) : (
            u.crews.map((c) => (
              <RecordRow
                key={c.slug}
                href={`/crews/${c.slug}`}
                title={c.name}
                note={`${dictLabel(t as never, `crew.role.${c.role}`, c.role)}${c.tier ? ` · ${c.tier}` : ""}`}
                end={c.status !== "active" ? <Chip>{c.status}</Chip> : undefined}
              />
            ))
          )}
        </Panel>
      </div>

      <Panel title={t("admin.secEdit")}>
        <p>{t("admin.editHint")}</p>
        <AdminUserEdit user={u} />
      </Panel>
    </>
  );
}
