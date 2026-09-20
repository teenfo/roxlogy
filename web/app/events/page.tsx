import Link from "next/link";
import { ArrowRight, Flag } from "lucide-react";
import { getRaceEvents } from "@/lib/cache";
import { getT } from "@/lib/i18n";
import { eventDateNote, eventPlace } from "@/lib/event-display";
import { Shell } from "@/components/rox/shell";
import { todayISOIn } from "@/lib/format";
import { QueryChoice, QueryFind } from "@/components/rox/query-filters";
import { Chip, Empty, Hint, PageHead, Panel, RecordRow } from "@/components/rox/ui";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.events"), description: t("events.desc") };
}

const REGIONS = ["asia", "europe", "north_america", "south_america", "africa", "oceania"] as const;

function formatRange(start: string | null, end: string | null, note: string | null, tag: string, tbd: string) {
  if (!start) return note ?? tbd;
  const s = new Date(start);
  const fmt = (d: Date) => d.toLocaleDateString(tag, { year: "numeric", month: "long", day: "numeric" });
  if (!end || end === start) return fmt(s);
  const e = new Date(end);
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  return sameMonth ? `${fmt(s)} – ${e.getDate()}` : `${fmt(s)} – ${fmt(e)}`;
}

/**
 * 대회 일정 — 시안 racing.tsx Events() 그대로 (PORT_PLAN §3-d):
 * PageHead · Panel[.rx-toolbar(Find · Choice 지역)] · .rx-two-col 의 .rx-event-card · Empty · Hint.
 * 검색·지역은 서버 필터(?q=·?region=)라 QueryFind·QueryChoice. 지난 대회는 시안에 없어 Panel + RowLink 로(§4).
 */
export default async function EventsPage({ searchParams }: { searchParams: Promise<{ q?: string; region?: string }> }) {
  const { q, region } = await searchParams;
  const { t, tag, locale, tz } = await getT();

  // 공개 대회 일정은 전역 캐시(1시간) — 검색·지역 필터는 메모리에서 처리
  const all = await getRaceEvents();
  const term = q?.trim().toLowerCase();
  const events = all.filter((e) => {
    if (region && (REGIONS as readonly string[]).includes(region) && e.region !== region) return false;
    if (!term) return true;
    // 검색은 한국어·영문 표기 양쪽에 매칭 (Seoul / 서울 둘 다 찾히도록)
    return [e.name, e.city, e.city_en, e.country, e.country_code].some((v) => (v ?? "").toLowerCase().includes(term));
  });

  const today = todayISOIn(tz);
  // 끝난 날 = end_date, 없으면 start_date. 날짜가 아예 없는 대회(일정 미정)만 다가오는 쪽 맨 뒤에 남는다.
  const endOf = (e: { start_date: string | null; end_date: string | null }) => e.end_date ?? e.start_date;
  const upcoming = events.filter((e) => !endOf(e) || endOf(e)! >= today);
  const past = events.filter((e) => endOf(e) && endOf(e)! < today);
  const range = (e: (typeof all)[number]) => formatRange(e.start_date, e.end_date, eventDateNote(t, e, tag), tag, t("events.tbd"));

  return (
    <Shell loginNext="/events">
      <PageHead title={t("events.title")} description={t("events.desc")} />
      <Panel>
        <div className="rx-toolbar">
          <QueryFind param="q" value={q ?? ""} placeholder={t("events.searchPh")} />
          <QueryChoice label={t("events.region")} param="region" value={region && (REGIONS as readonly string[]).includes(region) ? region : "all"} options={[["all", t("events.allRegions")], ...REGIONS.map((r) => [r, t(`events.region.${r}`)] as [string, string])]} />
        </div>
      </Panel>

      {!upcoming.length && !past.length ? (
        <Empty title={t("events.noResults")} description={t("events.desc")} />
      ) : (
        <>
          {upcoming.length > 0 && (
            <div className="rx-two-col">
              {upcoming.map((e) => (
                <Link className="rx-event-card" href={`/events/${e.id}`} key={e.id}>
                  <div>
                    <span>{e.season ?? t("events.upcoming")}</span>
                    <h2>{(e.city_en ?? e.city ?? e.name).toUpperCase()}</h2>
                    <Flag size={62} />
                  </div>
                  <section>
                    <Chip tone={e.country_code === "KR" ? "yellow" : "neutral"}>{e.country_code === "KR" ? t("events.koreaBadge") : eventPlace(t, e, locale)}</Chip>
                    <h3>{e.name}</h3>
                    <p>{range(e)}</p>
                    <span>
                      {[e.venue, e.region ? t(`events.region.${e.region}` as Parameters<typeof t>[0]) : null].filter(Boolean).join(" · ") || eventPlace(t, e, locale)}
                      <ArrowRight size={22} />
                    </span>
                  </section>
                </Link>
              ))}
            </div>
          )}
          {past.length > 0 && (
            <Panel title={t("events.past")}>
              {past.map((e) => (
                <RecordRow key={e.id} href={`/events/${e.id}`} title={e.name} note={eventPlace(t, e, locale)} end={range(e)} />
              ))}
            </Panel>
          )}
        </>
      )}

      <Hint>
        {t("events.disclaimer.before")}
        <a href="https://hyrox.com/find-my-race/" target="_blank" rel="noopener noreferrer">
          {t("events.disclaimer.link")}
        </a>
        {t("events.disclaimer.after")}
      </Hint>
    </Shell>
  );
}
