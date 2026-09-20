import { ArrowRight, Play } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { formatMs, formatDateShortYear } from "@/lib/format";
import {
  PFT_COLORS,
  PFT_STATIONS,
  badgeDictKey,
  badgeScale,
  cutoffsFor,
  toNextBadge,
  type PftResult,
} from "@/lib/pft";
import { PftDeleteButton } from "@/components/pft-form";
import { RecordCardButton } from "@/components/record-card-button";
import type { RecordCardData } from "@/lib/record-card";
import {
  Chip,
  DataTable,
  Empty,
  Go,
  Hint,
  PageHead,
  Panel,
  ProgressBar,
  RecordRow,
} from "@/components/rox/ui";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("pft.title") };
}

/**
 * PFT 허브 — 시안 racing.tsx 의 PFT(hub) 그대로 (PORT_PLAN §3-d):
 * PageHead(기록 추가 · 측정 시작) · .rx-two-col[ Panel.rx-pft-feature | Panel "나의 기록"(RecordRow·Hint) ]
 * · Panel "크루 PFT 레이스"(코드로 참가 · 레이스 만들기 · RecordRow · 스태프/보드 · 리더보드).
 * MY BEST 배지 게이지·전체 기록 표·규격은 시안에 없는 우리 정보라 Panel 로만 감싼다(§4-1).
 */
export default async function PftPage() {
  const [{ t, tag, tz }, user] = await Promise.all([getT(), getCachedUser()]);
  const supabase = await createClient();

  // "내 기록" 이므로 user_id 필터 필수 — shared 행은 RLS 로 전체 공개다
  const [
    { data, error },
    { data: myRaces },
    { data: createdRaces },
    { data: staffRows },
    { data: profile },
  ] = await Promise.all([
    supabase
      .from("pft_results")
      .select(
        "id, tested_on, total_ms, run_ms, burpee_ms, lunge_ms, row_ms, pushup_ms, wallball_ms, age, gender, scaled, badge, location, note, shared",
      )
      .eq("user_id", user!.id)
      .is("deleted_at", null)
      .order("tested_on", { ascending: false })
      .order("created_at", { ascending: false }),
    // 레이스 — 내가 참가한 최근 레이스 + 내가 만든 레이스(참가하지 않아도 스태프 타이밍으로)
    supabase
      .from("pft_race_entries")
      .select("joined_at, finished_at, total_ms, pft_races ( code, title, status, created_at )")
      .eq("user_id", user!.id)
      .order("joined_at", { ascending: false })
      .limit(5),
    supabase
      .from("pft_races")
      .select("code, title, status, created_at")
      .eq("created_by", user!.id)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("crew_members")
      .select("id")
      .eq("user_id", user!.id)
      .eq("status", "active")
      .in("role", ["owner", "coach"])
      .limit(1),
    supabase.from("profiles").select("is_admin, display_name").eq("id", user!.id).maybeSingle(),
  ]);

  const rows = (data ?? []) as PftResult[];
  type Race = { code: string; title: string; status: string; created_at: string };
  type RaceRow = {
    joined_at: string;
    finished_at: string | null;
    total_ms: number | null;
    pft_races: Race | Race[] | null;
  };
  const races = ((myRaces ?? []) as unknown as RaceRow[])
    .map((r) => ({ ...r, race: (Array.isArray(r.pft_races) ? r.pft_races[0] : r.pft_races) as Race | null }))
    .filter((r): r is typeof r & { race: Race } => !!r.race);
  const canCreateRace = !!profile?.is_admin || (staffRows ?? []).length > 0;
  const created = ((createdRaces ?? []) as Race[]).filter(
    (r) => !races.some((x) => x.race.code === r.code),
  );
  const best = rows.reduce<PftResult | null>(
    (a, r) => (a == null || r.total_ms < a.total_ms ? r : a),
    null,
  );
  const athlete = profile?.display_name?.trim() || "Athlete";
  /** 기록지에 얹을 값 — 사진은 브라우저에서만 합성한다(업로드하지 않음) */
  const cardFor = (r: PftResult): RecordCardData => ({
    kind: "PFT",
    athlete,
    subtitle: [
      formatDateShortYear(r.tested_on, tag, tz),
      r.location || null,
      r.scaled ? t("pft.scaledTag") : null,
    ]
      .filter(Boolean)
      .join(" · "),
    mainLabel: t("compare.total"),
    mainValue: formatMs(r.total_ms),
    badge: {
      text: t(badgeDictKey(r.badge)),
      tone: (r.badge === "gold" || r.badge === "silver" ? r.badge : "bronze") as
        | "gold"
        | "silver"
        | "bronze",
    },
    splits: PFT_STATIONS.some((st) => r[st.col] != null)
      ? PFT_STATIONS.map((st) => ({
          label: t(st.label),
          value: r[st.col] != null ? formatMs(r[st.col]) : "—",
          color: PFT_COLORS[st.key],
        }))
      : undefined,
  });
  const next = best ? toNextBadge(best.total_ms, best.age, best.scaled) : null;
  const cuts = cutoffsFor(best?.age ?? null);
  // 배지 게이지 — 0~30분 스케일 위에서 내 위치. 숫자만으로는 "골드까지 얼마나 남았나"가 감이 안 온다.
  const SCALE = 30 * 60_000;
  const pct = (ms: number) => Math.min(100, (ms / SCALE) * 100);
  const badgeTone = (b: string) => (b === "gold" ? "yellow" : b === "silver" ? "neutral" : "neutral");
  const recordNote = (r: PftResult) =>
    [
      formatDateShortYear(r.tested_on, tag, tz),
      r.location,
      r.scaled ? t("pft.scaledTag") : null,
      !r.shared ? t("pft.privateTag") : null,
    ]
      .filter(Boolean)
      .join(" · ");
  const raceStatus = (s: string) => t(s === "closed" ? "pft.race.closed" : "pft.race.open");

  return (
    <>
      <PageHead
        title={t("pft.hubTitle")}
        description={t("pft.hubDesc")}
        action={
          <div className="rx-actions">
            <Go href="/pft/new">{t("pft.add")}</Go>
            <Go href="/pft/measure" primary>
              <Play size={16} />
              {t("pft.mStartCta")}
            </Go>
          </div>
        }
      />
      {error && (
        <p role="alert" className="rx-error">
          {error.message}
        </p>
      )}

      <div className="rx-two-col">
        <Panel className="rx-pft-feature">
          <span>PHYSICAL FITNESS TEST</span>
          <h2>
            6 STATIONS.
            <br />
            ONE BENCHMARK.
          </h2>
          <p>{t("pft.featureDesc")}</p>
          <Go href="/pft/measure" primary>
            {t("pft.featureCta")} <ArrowRight size={16} />
          </Go>
        </Panel>
        <Panel title={t("pft.myRecords")} action={rows.length ? <Chip>{t("pft.recordN", { n: rows.length })}</Chip> : undefined}>
          {rows.length ? (
            <>
              {rows.slice(0, 4).map((r) => (
                <RecordRow
                  key={r.id}
                  href={`/pft/${r.id}/edit`}
                  title={`${formatMs(r.total_ms)} · ${t(badgeDictKey(r.badge))}`}
                  note={recordNote(r)}
                  end={
                    best && r.id === best.id ? (
                      <Chip tone="yellow">{t("pft.bestTitle")}</Chip>
                    ) : best ? (
                      <span className="rx-muted">+{formatMs(r.total_ms - best.total_ms)}</span>
                    ) : undefined
                  }
                />
              ))}
              <Hint>{t("pft.recordsHint")}</Hint>
            </>
          ) : (
            <Empty
              title={t("pft.empty")}
              description={t("pft.format")}
              action={
                <Go href="/pft/measure" primary>
                  {t("pft.mStartCta")}
                </Go>
              }
            />
          )}
        </Panel>
      </div>

      {best && (
        <Panel
          title="MY BEST"
          action={
            <div className="rx-actions">
              <Chip tone={badgeTone(best.badge)}>{t(badgeDictKey(best.badge))}</Chip>
              <RecordCardButton data={cardFor(best)} />
            </div>
          }
        >
          <div className="rx-summary-time">
            {formatMs(best.total_ms)}
            <small>
              {" "}
              {formatDateShortYear(best.tested_on, tag, tz)}
              {best.age != null && ` · ${t("pft.ageN", { n: best.age })}`}
              {best.scaled && ` · ${t("pft.scaledTag")}`}
            </small>
          </div>
          <ProgressBar value={pct(best.total_ms)} label={badgeScale(t, cuts, formatMs)} />
          <Hint>
            {next
              ? `${t(badgeDictKey(next.next))} ${formatMs(next.gapMs)} ${t("pft.toCut")}`
              : t("pft.topBadge")}
            {" · "}
            {badgeScale(t, cuts, formatMs)}
          </Hint>
          {PFT_STATIONS.some((st) => best[st.col] != null) && (
            <DataTable
              headers={PFT_STATIONS.map((st) => t(st.label))}
              rows={[
                PFT_STATIONS.map((st) => (
                  <strong key={st.key} className="rx-number" style={{ color: PFT_COLORS[st.key] }}>
                    {best[st.col] != null ? formatMs(best[st.col]) : "—"}
                  </strong>
                )),
              ]}
            />
          )}
        </Panel>
      )}

      <Panel
        title={t("pft.crewRaces")}
        action={
          <div className="rx-actions">
            <Go href="/pft/race/join">{t("pft.race.joinByCode")}</Go>
            {canCreateRace && <Go href="/pft/race/new">{t("pft.race.create")}</Go>}
          </div>
        }
      >
        {races.map((r) => (
          <RecordRow
            key={r.race.code}
            href={`/pft/race/${r.race.code}`}
            title={r.race.title}
            note={`${r.race.code} · ${formatDateShortYear(r.race.created_at, tag, tz)} · ${raceStatus(r.race.status)}`}
            end={r.finished_at ? formatMs(r.total_ms) : undefined}
          />
        ))}
        {created.map((r) => (
          <RecordRow
            key={r.code}
            href={`/pft/race/${r.code}/staff`}
            title={r.title}
            note={`${r.code} · ${formatDateShortYear(r.created_at, tag, tz)} · ${raceStatus(r.status)} · ${t("pft.race.staff")}`}
          />
        ))}
        {!races.length && !created.length && <Hint>{t("pft.noRacesHint")}</Hint>}
        <div className="rx-actions" style={{ marginTop: 16 }}>
          {[...races.map((r) => r.race), ...created].slice(0, 2).map((r) => (
            <Go key={r.code} href={`/board/${r.code}`}>
              {t("pft.race.linkBoard")} · {r.title}
            </Go>
          ))}
          <Go href="/pft/race">{t("pft.race.viewAll")}</Go>
          <Go href="/pft/leaderboard">
            {t("pft.boardTitle")} <ArrowRight size={16} />
          </Go>
        </div>
      </Panel>

      {rows.length > 0 && (
        <Panel title={t("pft.allRecords")}>
          <DataTable
            headers={[t("pft.fDate"), t("compare.total"), t("pft.badgeCol"), ""]}
            rows={rows.map((r) => [
              <span key="d">
                {formatDateShortYear(r.tested_on, tag, tz)}
                {r.location && <small className="rx-block rx-muted">{r.location}</small>}
              </span>,
              <strong key="t" className="rx-number">
                {formatMs(r.total_ms)}
              </strong>,
              <span key="b" style={{ whiteSpace: "nowrap" }}>
                <Chip tone={badgeTone(r.badge)}>{t(badgeDictKey(r.badge))}</Chip>
                {r.scaled && <> <Chip>{t("pft.scaledTag")}</Chip></>}
                {!r.shared && <> <Chip>{t("pft.privateTag")}</Chip></>}
              </span>,
              <span key="a" className="rx-actions" style={{ flexWrap: "nowrap", justifyContent: "flex-end" }}>
                <Go href={`/pft/${r.id}/edit`}>{t("common.edit")}</Go>
                <RecordCardButton data={cardFor(r)} />
                <PftDeleteButton id={r.id} />
              </span>,
            ])}
          />
        </Panel>
      )}

      <Panel title={t("pft.rulesTitle")} action={<Chip>{t("pft.noRest")}</Chip>}>
        <DataTable
          headers={[t("pft.stationCol"), t("pft.rulesTitle")]}
          rows={PFT_STATIONS.map((st, i) => [
            <span key="n">
              <Chip tone="yellow">{i + 1}</Chip> {t(st.label)}
            </span>,
            <span key="s">
              <b>{t(st.amount)}</b>
              {t(st.detail) && <small className="rx-block rx-muted">{t(st.detail)}</small>}
            </span>,
          ])}
        />
        <Hint>{t("pft.rulesBadge")}</Hint>
      </Panel>
    </>
  );
}
