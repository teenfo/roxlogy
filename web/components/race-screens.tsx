import { createClient } from "@/lib/supabase/server";
import { getCachedProfile, getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { Back, Empty, Go, PageHead } from "@/components/rox/ui";
import { PftRaceList, type RaceListRow } from "@/components/pft-race-list";
import { PftRacePick, type JoinableRace } from "@/components/pft-race-pick";
import { ProfileRequired, missingForRace } from "@/components/profile-required";
import { PftRaceCreateForm } from "@/components/pft-race-forms";
import { raceBase, raceHome, type RaceFormat } from "@/lib/race-format";

/**
 * 레이스 목록·참가·만들기 화면 — PFT 메뉴(/pft/race/*)와 타임체크 메뉴(/timing/*)가
 * 종목만 바꿔 같이 쓴다(2026-09-29 메뉴 분리). 페이지 파일은 이 화면을 부르기만 한다.
 */

type RaceRow = {
  id: string;
  code: string;
  title: string;
  status: string;
  created_at: string;
  join_open: boolean;
  format: RaceFormat | null;
  checkpoints: number | null;
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

/** 레이스 전체 목록 — 종목별(PFT 허브 / 타임체크 메뉴). 허브의 "최근 5개" 너머로 모두 찾아간다. */
export async function RaceListScreen({ format }: { format: RaceFormat }) {
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
        "started_at, splits, finished_at, total_ms, scaled, pft_races ( id, code, title, status, created_at, join_open, format, checkpoints, crews ( name ) )",
      )
      .eq("user_id", user!.id)
      .order("joined_at", { ascending: false })
      .limit(200),
    supabase
      .from("pft_races")
      .select("id, code, title, status, created_at, join_open, format, checkpoints, crews ( name )")
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
    format: r.format ?? "pft",
    checkpoints: r.checkpoints ?? 6,
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
  // 종목별 메뉴라 그 종목 레이스만 (옛 행은 format 이 없으면 PFT)
  const rows = [...byId.values()].filter((r) => r.format === format).sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );

  const isSim = format === "hyrox_sim";
  const href = raceBase(format);
  return (
    <>
      {!isSim && <Back href="/pft" label={t("pft.title")} />}
      <PageHead title={t(isSim ? "timing.title" : "pft.race.listTitle")} description={t(isSim ? "timing.desc" : "pft.race.listDesc")} action={
        <div className="rx-actions">
          <Go href={`${href}/join`}>{t("pft.race.join")}</Go>
          {canCreateRace && <Go href={`${href}/new`} primary>{t(isSim ? "timing.create" : "pft.race.create")}</Go>}
        </div>
      } />
      {loadErr ? <p role="alert" className="rx-error">{t("pft.race.listError")}</p> : rows.length === 0 ? (
        <Empty title={t(isSim ? "timing.empty" : "pft.race.listEmpty")} description={t(isSim ? "timing.desc" : "pft.race.listDesc")} action={<Go href={`${href}/join`}>{t("pft.race.join")}</Go>} />
      ) : <PftRaceList rows={rows} age={age} locale={tag} tz={tz} />}
    </>
  );
}

/** 레이스 참가 — 참가 가능한 레이스를 먼저 보여 주고 고르게 한다. 코드 입력은 보조 수단. */
export async function RaceJoinScreen({ format }: { format: RaceFormat }) {
  const { t, tag, tz } = await getT();
  const supabase = await createClient();
  // supabase-js 는 실패해도 throw 하지 않는다 — 빈 목록으로 보이면 "레이스가 없다"로 읽힌다
  const user = await getCachedUser();
  const [{ data, error }, { data: me }] = await Promise.all([
    supabase.rpc("pft_race_joinable"),
    supabase.from("profiles").select("birth_year, gender").eq("id", user!.id).maybeSingle(),
  ]);
  // 종목별 메뉴라 그 종목 레이스만 보인다(옛 응답엔 format 이 없으면 PFT)
  const races = (Array.isArray(data) ? (data as JoinableRace[]) : []).filter((r) => (r.format ?? "pft") === format);
  // 배지·순위가 나이·성별로 갈린다 — 비어 있으면 참가를 막고 프로필로 보낸다
  const missing = missingForRace(me as { birth_year: number | null; gender: string | null } | null);

  return (
    <>
      <Back href={raceHome(format)} label={t(format === "hyrox_sim" ? "timing.title" : "pft.title")} />
      <PageHead title={t("pft.race.join")} description={t("pft.race.joinPageDesc")} />
      {error && <p role="alert" className="rx-error">{t("pft.race.listError")}</p>}
      <ProfileRequired missing={missing} />
      <PftRacePick races={races} locale={tag} tz={tz} blocked={missing.length > 0} base={raceBase(format)} />
    </>
  );
}

/** 레이스 만들기 — 전체 관리자 또는 내가 운영진인 크루 */
export async function RaceNewScreen({ format }: { format: RaceFormat }) {
  const isSim = format === "hyrox_sim";
  const [{ t }, user, profile] = await Promise.all([getT(), getCachedUser(), getCachedProfile()]);
  const supabase = await createClient();
  const { data: staffRows } = await supabase
    .from("crew_members")
    .select("crews ( slug, name )")
    .eq("user_id", user!.id)
    .eq("status", "active")
    .in("role", ["owner", "coach"]);
  type Row = { crews: { slug: string; name: string } | { slug: string; name: string }[] | null };
  const crews = ((staffRows ?? []) as unknown as Row[])
    .map((r) => (Array.isArray(r.crews) ? r.crews[0] : r.crews))
    .filter((c): c is { slug: string; name: string } => !!c);
  const allowed = !!profile?.is_admin || crews.length > 0;

  return (
    <>
      <Back href={raceHome(format)} label={t(isSim ? "timing.title" : "pft.title")} />
      <PageHead title={t(isSim ? "timing.create" : "pft.race.create")} description={t(isSim ? "timing.createDesc" : "pft.race.createDesc")} />
      {allowed ? <PftRaceCreateForm crews={crews} fixedFormat={format} /> : (
        <Empty title={t("pft.race.err.not_allowed")} description={t(isSim ? "timing.createDesc" : "pft.race.createDesc")} action={<Go href={`${raceBase(format)}/join`}>{t("pft.race.join")}</Go>} />
      )}
    </>
  );
}
