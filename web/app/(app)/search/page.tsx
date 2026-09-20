import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { formatDateShort } from "@/lib/format";
import { QueryFind, QuerySegments } from "@/components/rox/query-filters";
import { Chip, Empty, Hint, PageHead, Panel, RecordRow } from "@/components/rox/ui";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("nav.search") };
}

type CrewHit = {
  slug: string;
  name: string;
  tagline: string | null;
  location: string | null;
  member_count: number;
};
type EventHit = {
  id: string;
  name: string;
  city: string | null;
  start_date: string;
};

/**
 * 통합 검색 — 시안 account.tsx SearchPage() 그대로 (PORT_PLAN §3-f):
 * PageHead · Panel[ Find · Segments(전체 · 크루 · 대회) · RowLink(end Chip 종류) · Empty ].
 * 검색은 서버가 하므로 QueryFind(?q=)·QuerySegments(?kind=). 크루와 공식 대회를 함께 찾는다.
 */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string }> }) {
  const { q, kind } = await searchParams;
  const { t, tag, tz } = await getT();
  const query = (q ?? "").trim();
  const which = kind === "crews" || kind === "events" ? kind : "all";

  let crews: CrewHit[] = [];
  let events: EventHit[] = [];

  if (query.length >= 1) {
    const supabase = await createClient();
    // ilike 패턴의 와일드카드는 이스케이프한다 — "%" 를 넣으면 전체가 걸린다
    const like = `%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const [{ data: c }, { data: e }] = await Promise.all([
      which === "events"
        ? Promise.resolve({ data: [] })
        : supabase.from("crews").select("slug, name, tagline, location, member_count").eq("status", "active").eq("is_public", true).or(`name.ilike.${like},location.ilike.${like},tagline.ilike.${like}`).limit(20),
      which === "crews" ? Promise.resolve({ data: [] }) : supabase.from("race_events").select("id, name, city, start_date").or(`name.ilike.${like},city.ilike.${like}`).order("start_date", { ascending: false }).limit(20),
    ]);
    crews = (c ?? []) as CrewHit[];
    events = (e ?? []) as EventHit[];
  }

  const empty = query.length >= 1 && !crews.length && !events.length;

  return (
    <>
      <PageHead title={t("search.hero")} description={t("search.heroDesc")} />
      <Panel>
        <QueryFind param="q" value={query} placeholder={t("nav.searchPh")} />
        <QuerySegments
          label={t("nav.search")}
          param="kind"
          value={which}
          options={[
            ["all", t("crew.finKindAll")],
            ["crews", t("nav.crews")],
            ["events", t("nav.events")],
          ]}
        />
        {crews.map((c) => (
          <RecordRow key={c.slug} href={`/crews/${c.slug}`} title={c.name} note={[c.location, c.tagline].filter(Boolean).join(" · ") || `${c.member_count} ${t("crew.members")}`} end={<Chip>{t("nav.crews")}</Chip>} />
        ))}
        {events.map((e) => (
          <RecordRow key={e.id} href={`/events/${e.id}`} title={e.name} note={[e.city, formatDateShort(e.start_date, tag, tz)].filter(Boolean).join(" · ")} end={<Chip>{t("nav.events")}</Chip>} />
        ))}
        {empty && <Empty title={t("search.empty")} description={t("search.heroDesc")} />}
        {!query && <Hint>{t("nav.searchPh")}</Hint>}
      </Panel>
    </>
  );
}
