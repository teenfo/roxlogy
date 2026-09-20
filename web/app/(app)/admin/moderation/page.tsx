import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { formatDate, formatMs } from "@/lib/format";
import { AdminSessionActions } from "@/components/admin-session-actions";
import { Chip, DataTable, Empty, Hint, Panel } from "@/components/rox/ui";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("admin.tabModeration") };
}

/** 세션 모더레이션 — 시안 Admin(moderation): Panel 기록 검토[ Hint · DataTable[기록 · 출처 · 시간 · 검토 상태 · 동작] ]. */
export default async function AdminModerationPage() {
  const supabase = await createClient();
  const { t, tag, tz } = await getT();

  // 관리자 RLS로 전체 세션 조회 — 최근 50개
  const { data: rows } = await supabase
    .from("sessions")
    .select("id, started_at, total_time_ms, division, leaderboard_excluded, source_device, user_id")
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
  const { data: profs } = userIds.length ? await supabase.from("profiles").select("id, display_name").in("id", userIds) : { data: [] };
  const nameMap = new Map(((profs ?? []) as { id: string; display_name: string | null }[]).map((p) => [p.id, p.display_name]));

  return (
    <Panel title={t("admin.modTitle")}>
      <Hint>{t("admin.modDesc")}</Hint>
      {sessions.length ? (
        <DataTable
          headers={[t("admin.colWhen"), t("admin.colUser"), t("admin.colTotal"), t("sessions.fltSource"), t("admin.colDivisionStat"), t("admin.reviewStatus"), ""]}
          rows={sessions.map((s) => [
            formatDate(s.started_at, tag, tz),
            nameMap.get(s.user_id) ?? <small key="u" className="rx-muted">{s.user_id.slice(0, 8)}</small>,
            <strong key="t" className="rx-number">
              {formatMs(s.total_time_ms)}
            </strong>,
            s.source_device ? t(`source.${s.source_device}` as Parameters<typeof t>[0]) : "—",
            s.division ? t(`division.${s.division}` as Parameters<typeof t>[0]) : "—",
            <Chip key="c" tone={s.leaderboard_excluded ? "neutral" : "green"}>
              {s.leaderboard_excluded ? t("admin.lbHidden") : t("admin.shown")}
            </Chip>,
            <AdminSessionActions key="a" sessionId={s.id} excluded={s.leaderboard_excluded} />,
          ])}
        />
      ) : (
        <Empty title={t("sessions.empty")} description={t("admin.modDesc")} />
      )}
    </Panel>
  );
}
