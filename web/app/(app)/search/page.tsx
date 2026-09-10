import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n";
import { formatDateShort } from "@/lib/format";
import { Avatar, Card } from "@/components/ui/crew-ui";
import { SearchBox } from "@/components/search-box";

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

/** 통합 검색 — 네비의 검색이 갈 곳. 크루와 공식 대회를 함께 찾는다. */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const { t, tag, tz } = await getT();
  const query = (q ?? "").trim();

  let crews: CrewHit[] = [];
  let events: EventHit[] = [];

  if (query.length >= 1) {
    const supabase = await createClient();
    // ilike 패턴의 와일드카드는 이스케이프한다 — "%" 를 넣으면 전체가 걸린다
    const like = `%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const [{ data: c }, { data: e }] = await Promise.all([
      supabase
        .from("crews")
        .select("slug, name, tagline, location, member_count")
        .eq("status", "active")
        .eq("is_public", true)
        .or(`name.ilike.${like},location.ilike.${like},tagline.ilike.${like}`)
        .limit(20),
      supabase
        .from("race_events")
        .select("id, name, city, start_date")
        .or(`name.ilike.${like},city.ilike.${like}`)
        .order("start_date", { ascending: false })
        .limit(20),
    ]);
    crews = (c ?? []) as CrewHit[];
    events = (e ?? []) as EventHit[];
  }

  const empty = query.length >= 1 && !crews.length && !events.length;

  return (
    <main>
      <h1 className="text-2xl font-bold">{t("nav.search")}</h1>
      <div className="mt-4 max-w-lg">
        <SearchBox initial={query} />
      </div>

      {empty && (
        <Card className="mt-6 px-4 py-12 text-center">
          <p className="text-sm text-muted">{t("search.empty")}</p>
        </Card>
      )}

      {crews.length > 0 && (
        <section className="mt-6">
          <p className="mb-2 text-xs font-bold text-muted">{t("nav.crews")}</p>
          <Card className="divide-y divide-line overflow-hidden">
            {crews.map((c) => (
              <Link
                key={c.slug}
                href={`/crews/${c.slug}`}
                className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-card-hover"
              >
                <Avatar name={c.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold">
                    {c.name}
                  </span>
                  <span className="block truncate text-[13px] text-muted">
                    {[c.location, c.tagline].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="tabular shrink-0 text-[13px] text-muted">
                  {c.member_count}
                </span>
              </Link>
            ))}
          </Card>
        </section>
      )}

      {events.length > 0 && (
        <section className="mt-6">
          <p className="mb-2 text-xs font-bold text-muted">{t("nav.events")}</p>
          <Card className="divide-y divide-line overflow-hidden">
            {events.map((e) => (
              <Link
                key={e.id}
                href={`/events/${e.id}`}
                className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-card-hover"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold">
                    {e.name}
                  </span>
                  {e.city && (
                    <span className="block truncate text-[13px] text-muted">
                      {e.city}
                    </span>
                  )}
                </span>
                <span className="tabular shrink-0 text-[13px] text-muted">
                  {formatDateShort(e.start_date, tag, tz)}
                </span>
              </Link>
            ))}
          </Card>
        </section>
      )}
    </main>
  );
}
