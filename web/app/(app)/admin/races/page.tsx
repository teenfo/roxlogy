import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { formatDateShortYear } from "@/lib/format";

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

/** 관리자 전체 레이스 — 누가 만들었든 모든 PFT 레이스를 한 화면에서 본다. */
export default async function AdminRacesPage() {
  const { t, tag, tz } = await getT();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pft_race_admin_list");
  const rows = (Array.isArray(data) ? (data as AdminRace[]) : []) ?? [];
  const denied = !Array.isArray(data) && (data as { error?: string } | null)?.error === "not_allowed";

  const open = rows.filter((r) => r.status !== "closed");
  const closed = rows.filter((r) => r.status === "closed");
  const chip = "rounded-md px-2 py-0.5 text-[11px] font-bold";
  const link = "text-xs font-semibold text-accent hover:underline";

  const table = (title: string, list: AdminRace[]) =>
    list.length === 0 ? null : (
      <section className="flex min-w-0 flex-col gap-2">
        <p className="text-sm font-bold">
          {title} <span className="tabular text-muted">{list.length}</span>
        </p>
        <div className="w-full overflow-x-auto rounded-2xl border border-line bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] font-bold tracking-[0.06em] text-muted">
                <th className="px-4 py-2.5">{t("admin.racesCol.race")}</th>
                <th className="px-4 py-2.5">{t("admin.racesCol.crew")}</th>
                <th className="px-4 py-2.5">{t("admin.racesCol.owner")}</th>
                <th className="px-4 py-2.5 text-right">{t("admin.racesCol.entries")}</th>
                <th className="px-4 py-2.5 text-right">{t("admin.racesCol.date")}</th>
                <th className="px-4 py-2.5 text-right">{t("admin.racesCol.links")}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className="border-b border-line-soft last:border-0">
                  <td className="px-4 py-3">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{r.title}</span>
                      <span
                        className={`${chip} ${
                          r.status === "closed" ? "bg-line text-muted" : "bg-success-bg text-success"
                        }`}
                      >
                        {t(r.status === "closed" ? "pft.race.ended" : "pft.race.open")}
                      </span>
                      {!r.join_open && (
                        <span className={`${chip} bg-line text-muted`}>{t("admin.racesNoCode")}</span>
                      )}
                    </span>
                    {r.join_open && (
                      <span className="mt-0.5 block font-mono text-xs tracking-[0.2em] text-muted">{r.code}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">{r.crew ?? "—"}</td>
                  <td className="px-4 py-3 text-muted">{r.created_by}</td>
                  <td className="tabular px-4 py-3 text-right">
                    {r.entries}
                    <span className="text-muted"> / {r.finished}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-muted">
                    {formatDateShortYear(r.created_at, tag, tz)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="flex justify-end gap-3">
                      <Link href={`/board/${r.code}`} className={link}>
                        {t("pft.race.linkBoard")}
                      </Link>
                      <Link href={`/pft/race/${r.code}/staff`} className={link}>
                        {t("pft.race.linkStaff")}
                      </Link>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <h1 className="text-xl font-extrabold">{t("admin.racesTitle")}</h1>
        <p className="mt-1 text-sm text-muted">{t("admin.racesDesc")}</p>
      </div>
      {error || denied ? (
        <p role="alert" className="rounded-2xl border border-line bg-card px-4 py-8 text-center text-sm text-danger">
          {t("pft.race.listError")}
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-line bg-card px-4 py-8 text-center text-sm text-muted">
          {t("admin.racesEmpty")}
        </p>
      ) : (
        <>
          {table(t("pft.race.sectionOpen"), open)}
          {table(t("pft.race.sectionPast"), closed)}
        </>
      )}
    </div>
  );
}
