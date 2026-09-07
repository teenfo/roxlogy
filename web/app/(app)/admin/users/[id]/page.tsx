import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { formatDate, formatDateShort } from "@/lib/format";
import { dictLabel } from "@/lib/dict-label";
import {
  AdminUserEdit,
  type AdminUserDetail,
} from "@/components/admin-user-edit";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("admin.userDetail") };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface px-4 py-2.5">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-0.5 break-all text-sm">{children}</p>
    </div>
  );
}

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { t, tag, tz } = await getT();
  const supabase = await createClient();

  // 관리자가 아니면 RPC 가 null 을 돌려준다 (레이아웃에서도 이미 막지만 이중으로)
  const { data } = await supabase.rpc("admin_user_detail", { p_user: id });
  if (!data) notFound();
  const u = data as AdminUserDetail;

  return (
    <main>
      <Link
        href="/admin/users"
        className="text-sm text-muted hover:text-foreground"
      >
        ← {t("admin.tabUsers")}
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">
          {u.display_name ?? t("admin.noName")}
        </h1>
        {u.is_admin && (
          <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold text-accent">
            admin
          </span>
        )}
        {u.disabled && (
          <span className="rounded bg-red-400/15 px-1.5 py-0.5 text-[10px] font-bold text-red-400">
            {t("admin.flagDisabled")}
          </span>
        )}
        {u.leaderboard_opt_in && (
          <span className="rounded bg-track/15 px-1.5 py-0.5 text-[10px] font-bold text-track">
            LB
          </span>
        )}
        <Link
          href={`/u/${u.id}`}
          className="ml-auto text-xs text-accent hover:underline"
        >
          {t("admin.viewPublic")}
        </Link>
      </div>

      {/* 계정 — 읽기 전용 */}
      <section className="mt-5">
        <h2 className="text-sm font-bold">{t("admin.secAccount")}</h2>
        <div className="mt-2 grid gap-px overflow-hidden rounded-md bg-muted/20 sm:grid-cols-2">
          <Row label="Email">{u.email ?? "—"}</Row>
          <Row label="User ID">
            <span className="font-mono text-xs">{u.id}</span>
          </Row>
          <Row label={t("admin.colJoined")}>
            {formatDate(u.created_at, tag, tz)}
          </Row>
          <Row label={t("admin.lastSignIn")}>
            {u.last_sign_in_at ? formatDate(u.last_sign_in_at, tag, tz) : "—"}
          </Row>
          <Row label={t("admin.emailConfirmed")}>
            {u.email_confirmed_at
              ? formatDateShort(u.email_confirmed_at, tag, tz)
              : t("admin.notConfirmed")}
          </Row>
          <Row label={t("admin.mcpToken")}>
            {u.has_mcp_token ? t("admin.tokenIssued") : t("admin.tokenNone")}
            <span className="ml-2 text-[11px] text-muted">
              {t("admin.tokenHidden")}
            </span>
          </Row>
        </div>
      </section>

      {/* 활동 */}
      <section className="mt-6">
        <h2 className="text-sm font-bold">{t("admin.secActivity")}</h2>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            [t("admin.colSessions"), u.session_count],
            [t("nav.races"), u.race_count],
            ["PFT", u.pft_count],
            [t("nav.programs"), u.program_count],
          ].map(([label, n]) => (
            <div key={String(label)} className="rounded-md bg-surface px-4 py-3">
              <p className="text-xs text-muted">{label}</p>
              <p className="mt-1 font-mono text-lg font-bold">{n}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">
          {t("admin.lastSession")}:{" "}
          {u.last_session_at ? formatDate(u.last_session_at, tag, tz) : "—"}
        </p>
      </section>

      {/* 크루 */}
      <section className="mt-6">
        <h2 className="text-sm font-bold">{t("admin.secCrews")}</h2>
        {!u.crews.length ? (
          <p className="mt-2 text-sm text-muted">—</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5">
            {u.crews.map((c) => (
              <li
                key={c.slug}
                className="flex flex-wrap items-center gap-2 rounded-md bg-surface px-4 py-2.5"
              >
                <Link
                  href={`/crews/${c.slug}`}
                  className="text-sm font-semibold hover:text-accent"
                >
                  {c.name}
                </Link>
                <span className="text-[11px] text-muted">
                  {dictLabel(t as never, `crew.role.${c.role}`, c.role)}
                  {c.tier ? ` · ${c.tier}` : ""}
                </span>
                {c.status !== "active" && (
                  <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-muted">
                    {c.status}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 수정 */}
      <section className="mt-8">
        <h2 className="text-sm font-bold">{t("admin.secEdit")}</h2>
        <p className="mt-1 text-xs text-muted">{t("admin.editHint")}</p>
        <div className="mt-3">
          <AdminUserEdit user={u} />
        </div>
      </section>
    </main>
  );
}
