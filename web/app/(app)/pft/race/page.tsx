import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { PftRaceList, type RaceListRow } from "@/components/pft-race-list";
import { Back, Empty, Go, PageHead } from "@/components/rox/ui";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("pft.race.listTitle") };
}

type RaceRow = {
  id: string;
  code: string;
  title: string;
  status: string;
  created_at: string;
  join_open: boolean;
  crews: { name: string } | { name: string }[] | null;
};

type EntryRow = {
  started_at: string | null;
  splits: number[] | null;
  finished_at: string | null;
  total_ms: number | null;
  scaled: boolean;
  pft_races: RaceRow | RaceRow[] | null;
};

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/**
 * 레이스 전체 목록 — 시안 허브의 "크루 PFT 레이스" Panel 을 페이지로(PORT_PLAN §3-d, 시안에는
 * 목록 라우트가 없다). Back · PageHead(코드로 참가 · 레이스 만들기) · Panel 진행 중 · Panel 지난 레이스.
 * 허브의 "최근 5개" 너머로 지난 레이스를 모두 찾아간다.
 */
export default async function PftRaceListPage() {
  const [{ t, tag, tz }, user] = await Promise.all([getT(), getCachedUser()]);
  const supabase = await createClient();

  // "내 레이스" 이므로 user_id / created_by 필터 필수 — 레이스는 RLS 로 전체 공개다(보드용)
  const [
    { data: entryRows, error: entryErr },
    { data: createdRows, error: createdErr },
    { data: me },
    { data: staffRows },
  ] = await Promise.all([
    supabase
      .from("pft_race_entries")
      .select(
        "started_at, splits, finished_at, total_ms, scaled, pft_races ( id, code, title, status, created_at, join_open, crews ( name ) )",
      )
      .eq("user_id", user!.id)
      .order("joined_at", { ascending: false })
      .limit(200),
    supabase
      .from("pft_races")
      .select("id, code, title, status, created_at, join_open, crews ( name )")
      .eq("created_by", user!.id)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("profiles").select("birth_year, is_admin").eq("id", user!.id).maybeSingle(),
    // 레이스를 만들 수 있는 건 관리자·크루 운영진뿐이다(허브와 같은 판정).
    supabase
      .from("crew_members")
      .select("id")
      .eq("user_id", user!.id)
      .eq("status", "active")
      .in("role", ["owner", "coach"])
      .limit(1),
  ]);

  // supabase-js 는 실패해도 throw 하지 않는다 — 확인 없이 빈 목록을 그리면
  // "레이스가 없다"로 읽혀서 사용자가 기록을 잃었다고 오해한다.
  const loadErr = entryErr ?? createdErr;
  const age = me?.birth_year != null ? new Date().getFullYear() - Number(me.birth_year) : null;
  const canCreateRace = !!me?.is_admin || (staffRows ?? []).length > 0;

  // 참가한 것과 만든 것을 레이스 기준으로 합친다(둘 다인 경우가 흔하다)
  const byId = new Map<string, RaceListRow>();
  const base = (r: RaceRow): RaceListRow => ({
    id: r.id,
    code: r.code,
    title: r.title,
    status: r.status,
    created_at: r.created_at,
    join_open: r.join_open,
    crew: one(r.crews)?.name ?? null,
    mine: false,
    created: false,
    started: false,
    doneCount: 0,
    finished: false,
    total_ms: null,
    scaled: false,
  });
  for (const e of (entryRows ?? []) as unknown as EntryRow[]) {
    const race = one(e.pft_races);
    if (!race) continue;
    byId.set(race.id, {
      ...base(race),
      mine: true,
      started: !!e.started_at,
      doneCount: e.splits?.length ?? 0,
      finished: !!e.finished_at,
      total_ms: e.total_ms,
      scaled: e.scaled,
    });
  }
  for (const r of (createdRows ?? []) as unknown as RaceRow[]) {
    const prev = byId.get(r.id);
    if (prev) prev.created = true;
    else byId.set(r.id, { ...base(r), created: true });
  }
  const rows = [...byId.values()].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );

  return (
    <>
      <Back href="/pft" label={t("pft.title")} />
      <PageHead
        title={t("pft.race.listTitle")}
        description={t("pft.race.listDesc")}
        action={
          <div className="rx-actions">
            <Go href="/pft/race/join">{t("pft.race.joinByCode")}</Go>
            {canCreateRace && (
              <Go href="/pft/race/new" primary>
                {t("pft.race.create")}
              </Go>
            )}
          </div>
        }
      />
      {loadErr ? (
        <p role="alert" className="rx-error">
          {t("pft.race.listError")}
        </p>
      ) : rows.length === 0 ? (
        <Empty
          title={t("pft.race.listEmpty")}
          description={t("pft.race.listDesc")}
          action={<Go href="/pft/race/join">{t("pft.race.join")}</Go>}
        />
      ) : (
        <PftRaceList rows={rows} age={age} locale={tag} tz={tz} />
      )}
    </>
  );
}
