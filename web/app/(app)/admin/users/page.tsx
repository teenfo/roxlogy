import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { formatDateShort } from "@/lib/format";
import { AdminUserActions } from "@/components/admin-user-actions";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("admin.tabUsers") };
}

type AdminUser = {
  id: string;
  display_name: string | null;
  created_at: string;
  is_admin: boolean;
  disabled: boolean;
  leaderboard_opt_in: boolean;
  session_count: number;
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const supabase = await createClient();
  const { t, tag } = await getT();

  const { data } = await supabase.rpc("admin_users", { p_search: q ?? null });
  const users = (data ?? []) as AdminUser[];

  return (
    <main>
      <h1 className="text-xl font-bold">{t("admin.usersTitle")}</h1>
      <form className="mt-4" action="/admin/users">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder={t("admin.searchName")}
          className="w-full max-w-sm rounded-md border border-muted/30 bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </form>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface text-left text-xs text-muted">
              <th className="py-2 pr-4 font-normal">{t("admin.colUser")}</th>
              <th className="py-2 pr-4 font-normal">{t("admin.colJoined")}</th>
              <th className="py-2 pr-4 text-right font-normal">{t("admin.colSessions")}</th>
              <th className="py-2 pr-4 font-normal">{t("admin.colFlags")}</th>
              <th className="py-2 text-right font-normal">{t("admin.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-surface/60">
                <td className="py-2.5 pr-4">
                  <span className="font-medium">
                    {u.display_name ?? t("admin.noName")}
                  </span>
                  <span className="ml-2 font-mono text-[10px] text-muted">
                    {u.id.slice(0, 8)}
                  </span>
                </td>
                <td className="py-2.5 pr-4 text-muted">
                  {formatDateShort(u.created_at, tag)}
                </td>
                <td className="py-2.5 pr-4 text-right tabular-nums">
                  {u.session_count}
                </td>
                <td className="py-2.5 pr-4">
                  <span className="flex flex-wrap gap-1">
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
                  </span>
                </td>
                <td className="py-2.5">
                  <AdminUserActions
                    userId={u.id}
                    isAdmin={u.is_admin}
                    disabled={u.disabled}
                  />
                </td>
              </tr>
            ))}
            {!users.length && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-sm text-muted">
                  {t("admin.noUsers")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
