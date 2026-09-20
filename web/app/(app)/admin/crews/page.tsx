import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { AdminCrewStatus } from "@/components/admin-crew-status";
import { Chip, Empty, Panel, RecordRow } from "@/components/rox/ui";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("admin.crewsTitle") };
}

type CrewRow = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  location: string | null;
  join_policy: string;
  status: "pending" | "active" | "rejected";
  created_at: string;
};

/** 크루 관리 — 시안 Admin(crews): Panel 등록 크루[RowLink]. 승인 대기는 버튼이 필요해 .rx-record-row 모양의 div(§4). */
export default async function AdminCrewsPage() {
  const supabase = await createClient();
  const { t } = await getT();
  // 관리자는 RLS(crews_select_public 의 is_admin 분기)로 전체 크루 조회 가능
  const { data } = await supabase.from("crews").select("id, slug, name, tagline, location, join_policy, status, created_at").order("created_at", { ascending: false });
  const crews = (data ?? []) as CrewRow[];
  const pending = crews.filter((c) => c.status === "pending");
  const rest = crews.filter((c) => c.status !== "pending");

  return (
    <>
      <Panel title={t("admin.crewsPending")} action={<Chip tone={pending.length ? "yellow" : "neutral"}>{pending.length}</Chip>}>
        {!pending.length ? (
          <Empty title={t("admin.crewsEmpty")} description={t("admin.crewsPending")} />
        ) : (
          pending.map((c) => (
            <div key={c.id} className="rx-record-row" style={{ cursor: "default" }}>
              <span>
                <b>
                  <Link href={`/crews/${c.slug}`}>{c.name}</Link>
                </b>
                <small>
                  /{c.slug} · {c.join_policy}
                  {c.location ? ` · ${c.location}` : ""}
                </small>
              </span>
              <AdminCrewStatus crewId={c.id} />
            </div>
          ))
        )}
      </Panel>
      <Panel title={t("admin.crewsAll")} action={<span className="rx-muted">{rest.length}</span>}>
        {rest.map((c) => (
          <RecordRow key={c.id} href={`/crews/${c.slug}`} title={c.name} note={`/${c.slug}${c.location ? ` · ${c.location}` : ""}`} end={<Chip tone={c.status === "active" ? "green" : "red"}>{c.status}</Chip>} />
        ))}
        {!rest.length && <Empty title={t("admin.crewsEmpty")} description={t("admin.crewsAll")} />}
      </Panel>
    </>
  );
}
