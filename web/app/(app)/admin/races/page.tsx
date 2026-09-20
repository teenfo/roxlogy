import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { formatDateShortYear } from "@/lib/format";
import { Chip, Empty, Hint, Panel, RecordRow } from "@/components/rox/ui";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("admin.racesTitle") };
}

type AdminRace = {
  id: string;
  code: string;
  title: string;
  status: string;
  join_open: boolean;
  created_at: string;
  closed_at: string | null;
  crew: string | null;
  created_by: string;
  entries: number;
  finished: number;
};

/** 관리자 전체 레이스 — 시안 Admin(races): Panel PFT 레이스[RowLink(제목 · 상태 · 완주)]. 스태프 화면으로 간다. */
export default async function AdminRacesPage() {
  const { t, tag, tz } = await getT();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pft_race_admin_list");
  const rows = (Array.isArray(data) ? (data as AdminRace[]) : []) ?? [];
  const denied = !Array.isArray(data) && (data as { error?: string } | null)?.error === "not_allowed";

  const open = rows.filter((r) => r.status !== "closed");
  const closed = rows.filter((r) => r.status === "closed");

  const list = (title: string, items: AdminRace[]) => (
    <Panel title={title} action={<span className="rx-muted">{items.length}</span>}>
      {items.length ? (
        items.map((r) => (
          <RecordRow
            key={r.id}
            href={`/pft/race/${r.code}/staff`}
            title={r.title}
            note={[t(r.status === "closed" ? "pft.race.ended" : "pft.race.open"), r.join_open ? r.code : t("admin.racesNoCode"), r.crew, r.created_by, formatDateShortYear(r.created_at, tag, tz)].filter(Boolean).join(" · ")}
            end={
              <>
                {r.finished} / {r.entries}
              </>
            }
          />
        ))
      ) : (
        <Empty title={t("admin.racesEmpty")} description={t("admin.racesDesc")} />
      )}
    </Panel>
  );

  if (error || denied) {
    return (
      <Panel title={t("admin.racesTitle")}>
        <p role="alert" className="rx-error">
          {t("pft.race.listError")}
        </p>
      </Panel>
    );
  }

  return (
    <>
      {list(t("pft.race.sectionOpen"), open)}
      {list(t("pft.race.sectionPast"), closed)}
      <Hint>
        <Chip>{t("pft.race.linkStaff")}</Chip> {t("admin.racesDesc")}
      </Hint>
    </>
  );
}
