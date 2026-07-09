import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { formatDate, formatMs } from "@/lib/format";
import { AdminSessionActions } from "@/components/admin-session-actions";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("admin.tabModeration") };
}

export default async function AdminModerationPage() {
  const supabase = await createClient();
  const { t, tag } = await getT();

  // 관리자 RLS로 전체 세션 조회 — 최근 50개
  const { data: rows } = await supabase
    .from("sessions")
    .select(
      "id, started_at, total_time_ms, division, leaderboard_excluded, source_device, user_id",
    )
    .is("deleted_at", null)
    .order("started_at", { ascending: false })
    .limit(50);

  type Row = {
    id: string;
    started_at: string;
    total_time_ms: number | null;
    division: string | null;
    leaderboard_excluded: boolean;
    source_device: string | null;
    user_id: string;
  };
  const sessions = (rows ?? []) as Row[];

  // 세션 소유자 이름 (관리자 RLS로 전체 profiles 조회)
  const userIds = [...new Set(sessions.map((s) => s.user_id))];
  const { data: profs } = userIds.length
    ? await supabase.from("profiles").select("id, display_name").in("id", userIds)
    : { data: [] };
  const nameMap = new Map(
    ((profs ?? []) as { id: string; display_name: string | null }[]).map((p) => [
      p.id,
      p.display_name,
    ]),
  );

  return (
    <main>
      <h1 className="text-xl font-bold">{t("admin.modTitle")}</h1>
      <p className="mt-1 text-sm text-muted">{t("admin.modDesc")}</p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface text-left text-xs text-muted">
              <th className="py-2 pr-4 font-normal">{t("admin.colWhen")}</th>
              <th className="py-2 pr-4 font-normal">{t("admin.colUser")}</th>
              <th className="py-2 pr-4 text-right font-normal">{t("admin.colTotal")}</th>
              <th className="py-2 pr-4 font-normal">{t("sessions.fltSource")}</th>
              <th className="py-2 pr-4 font-normal">{t("newSession.division")}</th>
              <th className="py-2 text-right font-normal">{t("admin.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} className="border-b border-surface/60">
                <td className="py-2.5 pr-4 text-muted">
                  {formatDate(s.started_at, tag)}
                </td>
                <td className="py-2.5 pr-4">
                  {nameMap.get(s.user_id) ?? (
                    <span className="font-mono text-[10px] text-muted">
                      {s.user_id.slice(0, 8)}
                    </span>
                  )}
                </td>
                <td className="py-2.5 pr-4 text-right font-mono">
                  {formatMs(s.total_time_ms)}
                  {s.leaderboard_excluded && (
                    <span className="ml-2 rounded bg-muted/20 px-1.5 py-0.5 text-[10px] text-muted">
                      {t("admin.lbHidden")}
                    </span>
                  )}
                </td>
                <td className="py-2.5 pr-4">
                  {s.source_device
                    ? t(`source.${s.source_device}` as Parameters<typeof t>[0])
                    : "—"}
                </td>
                <td className="py-2.5 pr-4">
                  {s.division
                    ? t(`division.${s.division}` as Parameters<typeof t>[0])
                    : "—"}
                </td>
                <td className="py-2.5">
                  <AdminSessionActions
                    sessionId={s.id}
                    excluded={s.leaderboard_excluded}
                  />
                </td>
              </tr>
            ))}
            {!sessions.length && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-sm text-muted">
                  {t("sessions.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
