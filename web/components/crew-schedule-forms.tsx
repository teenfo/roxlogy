"use client";

import { usePathname, useRouter } from "next/navigation";
import { DIVISIONS } from "@/lib/divisions";
import { useState } from "react";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { dictLabel } from "@/lib/dict-label";
import { duesErrText } from "@/lib/dues-error";
import { formatMs as fmtMs } from "@/lib/format";
import { won } from "@/lib/won";
import { crewRoleChipTone, crewRoleDictKey, isStaffRole, tierChipTone } from "@/lib/crew-role";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RoxDialog } from "@/components/rox/dialog";
import { Person } from "@/components/rox/person";
import { RowMenu } from "@/components/crew-ledger-table";
import { Chip, Choice, DataTable, Empty, Field, Hint, Panel, RecordRow, Segments } from "@/components/rox/ui";

/**
 * 크루 일정 폼·버튼 묶음 — 시안 crew.tsx CrewSchedule 의 프리미티브(Segments·Panel·Input·Button·
 * RowLink)로만 그린다 (PORT_PLAN §3-e). 모임 등록·대회일정·출석 체크·설정 토글은 시안에 없는 우리
 * 기능이라 RoxDialog·DataTable·Checkbox·RowMenu 로 감싼다(§4). Supabase 호출은 전부 그대로다.
 */

/** 모임 등록 — 스태프 전용. crew_events RLS(is_crew_staff)가 권한을 강제한다. */
export type MeetupEditable = {
  id: string;
  title: string;
  starts_at: string;
  location: string | null;
  description: string | null;
  capacity: number | null;
  comments_allowed: boolean;
};

/** ISO(UTC) → datetime-local 입력값. 생성 폼이 브라우저 로컬 시각으로 해석하므로
 *  수정도 같은 기준으로 보여준다. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/** 모임 등록·수정 폼. event 를 주면 수정 모드.
 *
 *  수정 모드에서는 무료 행사·정회원 전용을 다루지 않는다 — 그 둘은 상세 화면의
 *  전용 토글(set_event_fee_exempt / set_event_members_only)이 회차비 회수와
 *  숨겨진 참석자 수 안내까지 처리한다. 여기서 raw update 로 바꾸면 그 로직을
 *  건너뛰어 청구가 어긋난다. */
export function CrewMeetupForm({
  crewId,
  event,
  open: openProp,
  onOpenChange,
}: {
  crewId?: string;
  event?: MeetupEditable;
  /** 트리거를 밖(⋯ 메뉴)에 둘 때 — 열림 상태를 부모가 쥔다 */
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const editing = !!event;
  const controlled = openProp !== undefined;
  const [openState, setOpenState] = useState(false);
  const open = controlled ? openProp : openState;
  const setOpen = (next: boolean) => {
    if (controlled) onOpenChange?.(next);
    else setOpenState(next);
  };
  const [title, setTitle] = useState(event?.title ?? "");
  const [when, setWhen] = useState(event ? toLocalInput(event.starts_at) : "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [desc, setDesc] = useState(event?.description ?? "");
  const [capacity, setCapacity] = useState(event?.capacity != null ? String(event.capacity) : "");
  const [feeExempt, setFeeExempt] = useState(false);
  const [membersOnly, setMembersOnly] = useState(false);
  const [commentsAllowed, setCommentsAllowed] = useState(event?.comments_allowed ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !when) return;
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const cap = /^\d+$/.test(capacity.trim()) && parseInt(capacity, 10) > 0 ? parseInt(capacity, 10) : null;
    // 정원을 늘리면 대기자 자동 승급은 crew_events 트리거가 처리한다
    const common = {
      title: title.trim(),
      starts_at: new Date(when).toISOString(),
      location: location.trim() || null,
      description: desc.trim() || null,
      capacity: cap,
      comments_allowed: commentsAllowed,
    };
    const { error } = editing
      ? await supabase.from("crew_events").update(common).eq("id", event!.id)
      : await supabase.from("crew_events").insert({
          ...common,
          crew_id: crewId,
          kind: "social",
          members_only: membersOnly,
          fee_exempt: feeExempt,
          created_by: (await supabase.auth.getUser()).data.user?.id ?? null,
        });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    if (editing) {
      setOpen(false);
      router.refresh();
      return;
    }
    setTitle("");
    setWhen("");
    setLocation("");
    setDesc("");
    setCapacity("");
    setMembersOnly(false);
    setCommentsAllowed(true);
    setOpen(false);
    router.refresh();
  }

  const heading = editing ? t("crew.meetupEdit") : t("crew.meetupAdd");
  return (
    <>
      {/* 제어형이면 트리거는 부모(⋯ 메뉴)가 그린다 */}
      {!controlled && (
        <Button type="button" className="rx-primary" onClick={() => setOpen(true)}>
          {editing ? (
            t("common.edit")
          ) : (
            <>
              <Plus size={16} />
              {t("crew.meetupAdd")}
            </>
          )}
        </Button>
      )}
      <RoxDialog open={open} onOpenChange={setOpen} title={heading}>
        <form onSubmit={save}>
          <Field label={t("crew.meetupTitlePh")}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("crew.meetupTitlePh")} maxLength={80} required />
          </Field>
          <div className="rx-form-grid">
            <Field label={t("crew.colWhen")}>
              <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
            </Field>
            <Field label={t("crew.meetupLocationPh")}>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t("crew.meetupLocationPh")} maxLength={80} />
            </Field>
          </div>
          <Field label={t("crew.meetupDescPh")}>
            <Textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t("crew.meetupDescPh")} maxLength={1000} />
          </Field>
          <Field label={t("crew.meetupCapacityPh")}>
            <Input value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder={t("crew.meetupCapacityPh")} inputMode="numeric" maxLength={4} />
          </Field>
          {!editing && (
            <label className="rx-check">
              <Checkbox checked={membersOnly} onCheckedChange={(v) => setMembersOnly(v === true)} />
              <span>
                {t("crew.fullOnly")} <small className="rx-muted">{t("crew.fullOnlyMeetupHint")}</small>
              </span>
            </label>
          )}
          <label className="rx-check">
            <Checkbox checked={commentsAllowed} onCheckedChange={(v) => setCommentsAllowed(v === true)} />
            <span>{t("crew.allowComments")}</span>
          </label>
          {!editing && (
            <label className="rx-check">
              <Checkbox checked={feeExempt} onCheckedChange={(v) => setFeeExempt(v === true)} />
              <span>
                {t("crew.feeExempt")} <small className="rx-muted">{t("crew.feeExemptHint")}</small>
              </span>
            </label>
          )}
          {err && (
            <p role="alert" className="rx-error">
              {err}
            </p>
          )}
          <div className="rx-actions">
            <Button type="submit" className="rx-primary" disabled={busy || !title.trim() || !when}>
              {busy ? t("common.saving") : editing ? t("common.save") : t("crew.meetupCreate")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      </RoxDialog>
    </>
  );
}

const bibOk = (v: string) => v.trim() === "" || /^\d{4,8}$/.test(v.trim());

/** 대회일정 공통 입력 칸 — 등록·수정이 같은 칸·같은 검증을 쓴다. */
function RacePlanFields({
  title,
  setTitle,
  date,
  setDate,
  division,
  setDivision,
  bib,
  setBib,
  note,
  setNote,
  titleField,
}: {
  title: string;
  setTitle: (v: string) => void;
  date: string;
  setDate: (v: string) => void;
  division: string;
  setDivision: (v: string) => void;
  bib: string;
  setBib: (v: string) => void;
  note: string;
  setNote: (v: string) => void;
  /** 제목 칸을 밖에서 그릴 때(공식 대회 검색) — 생략하면 기본 제목 칸 */
  titleField?: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <>
      {titleField ?? (
        <Field label={t("crew.racePlanTitlePh")}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("crew.racePlanTitlePh")} maxLength={80} required />
        </Field>
      )}
      <Field label={t("crew.colWhen")}>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </Field>
      <div className="rx-form-grid">
        <Field label={t("crew.racePlanDivisionPh")}>
          <Choice
            label={t("crew.racePlanDivisionPh")}
            value={division || "none"}
            onChange={(v) => setDivision(v === "none" ? "" : v)}
            options={[["none", t("crew.racePlanDivisionPh")], ...DIVISIONS.map((d) => [d, t(`division.${d}` as Parameters<typeof t>[0])] as [string, string])]}
          />
        </Field>
        <Field label={t("crew.racePlanBibPh")}>
          <Input value={bib} onChange={(e) => setBib(e.target.value)} placeholder={t("crew.racePlanBibPh")} maxLength={8} inputMode="numeric" />
        </Field>
      </div>
      <Hint>{t("crew.racePlanBibHint")}</Hint>
      <Field label={t("crew.racePlanNotePh")}>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("crew.racePlanNotePh")} maxLength={80} />
      </Field>
    </>
  );
}

/**
 * 내 대회일정 상세의 편집 — 목록과 같은 필드·같은 검증을 쓴다.
 * 펼치면 RoxDialog 로 띄운다(입력이 여러 줄이라 카드 안에서는 눌린다).
 * 삭제하면 돌아갈 계획이 없으므로 일정 목록으로 보낸다.
 */
export function RacePlanEditor({
  plan,
  backHref = "/schedule",
}: {
  /** 삭제하면 돌아갈 곳 — 상세로 들어온 경로를 그대로 되돌려준다 */
  backHref?: string;
  plan: {
    id: string;
    title: string;
    race_date: string;
    division: string | null;
    bib: string | null;
    note: string | null;
  };
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(plan.title);
  const [date, setDate] = useState(plan.race_date);
  const [division, setDivision] = useState(plan.division ?? "");
  const [bib, setBib] = useState(plan.bib ?? "");
  const [note, setNote] = useState(plan.note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !date || !bibOk(bib)) return;
    setBusy(true);
    setErr(null);
    const { error } = await createClient()
      .from("race_plans")
      .update({
        title: title.trim(),
        race_date: date,
        division: division.trim() || null,
        bib: bib.trim() || null,
        note: note.trim() || null,
      })
      .eq("id", plan.id);
    setBusy(false);
    if (error) return setErr(error.message);
    setOpen(false);
    router.refresh();
  }

  async function del() {
    if (!window.confirm(t("crew.racePlanDelConfirm"))) return;
    setBusy(true);
    setErr(null);
    const { error } = await createClient().from("race_plans").delete().eq("id", plan.id);
    setBusy(false);
    if (error) return setErr(error.message);
    router.push(backHref);
    router.refresh();
  }

  return (
    <span className="rx-actions" style={{ marginTop: 0 }}>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        {t("common.edit")}
      </Button>
      <Button type="button" variant="ghost" className="rx-pft-close" onClick={del} disabled={busy}>
        {t("common.delete")}
      </Button>
      {err && (
        <span role="alert" className="rx-error">
          {err}
        </span>
      )}
      <RoxDialog open={open} onOpenChange={setOpen} title={t("common.edit")}>
        {open && (
          <form onSubmit={save}>
            <RacePlanFields {...{ title, setTitle, date, setDate, division, setDivision, bib, setBib, note, setNote }} />
            {err && (
              <p role="alert" className="rx-error">
                {err}
              </p>
            )}
            <div className="rx-actions">
              <Button type="submit" className="rx-primary" disabled={busy || !title.trim() || !date || !bibOk(bib)}>
                {busy ? t("common.saving") : t("common.save")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
            </div>
          </form>
        )}
      </RoxDialog>
    </span>
  );
}

export type PlanPartnerRow = {
  user_id: string;
  name: string;
  status: "pending" | "accepted" | "declined";
};

/** my_race_plans() 한 행 — 내가 만든 계획과 파트너로 초대받은 계획이 섞여 온다 */
export type MyRacePlan = {
  id: string;
  title: string;
  race_date: string;
  division: string | null;
  bib: string | null;
  note: string | null;
  goal_plan_id: string | null;
  race_event_id: string | null;
  role: "owner" | "partner";
  /** 내가 초대받은 쪽일 때 내 응답 상태 */
  my_status: "pending" | "accepted" | "declined" | null;
  owner_name: string;
  partners: PlanPartnerRow[];
  goal_target_ms: number | null;
  goal_run_ms: number | null;
  goal_station_ms: number | null;
  goal_roxzone_ms: number | null;
};

type RaceEventRow = {
  id: string;
  name: string;
  city: string;
  city_en: string | null;
  start_date: string | null;
};

/** 내 대회 참가 일정 — 본인이 등록·수정·삭제한다 (race_plans, own RLS).
 *  크루 전용이 아니다: 개인 일정 화면(/schedule)과 크루 일정표 양쪽에서 쓴다.
 *  공식 대회(race_events)를 검색해 고르면 이름·날짜가 채워지고 대회에 연결되며,
 *  목록에 없는 대회는 입력한 이름 그대로 등록된다.
 *
 *  목록은 시안 training.tsx "내 레이스 일정" 의 RowLink(RecordRow) 그대로 — 제목 · 날짜·디비전 · D-day.
 *  수정·삭제는 상세(RacePlanEditor)에서 한다(목록 인라인 수정은 시안에 없어 뺐다, §4). */
export function RacePlanForm({
  myPlans,
  part,
  today,
}: {
  myPlans: MyRacePlan[];
  /** 등록 버튼과 내 대회 목록을 다른 자리에 둘 때 나눠 그린다.
   *  생략하면 지금까지처럼 둘 다 그린다. */
  part?: "trigger" | "list";
  /** 사용자 시간대의 오늘(YYYY-MM-DD). D-day 계산용 — 렌더 중 new Date() 를
   *  쓰면 순수하지 않고 서버 UTC 기준이라 하루가 어긋난다. */
  today: string;
}) {
  const { t, tag } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [division, setDivision] = useState("");
  const [bib, setBib] = useState("");
  const [note, setNote] = useState("");
  const [eventId, setEventId] = useState<string | null>(null);
  const [events, setEvents] = useState<RaceEventRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function openForm() {
    setOpen(true);
    if (events !== null) return;
    // 다가오는 공식 대회 목록 — 공개 테이블(전체 읽기 허용)
    const supabase = createClient();
    const { data } = await supabase
      .from("race_events")
      .select("id, name, city, city_en, start_date")
      // 오늘 이후 + 최근 30일(막 끝난 대회를 뒤늦게 등록하는 경우)
      .gte("start_date", new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
      .order("start_date", { ascending: true })
      .limit(100);
    setEvents((data ?? []) as RaceEventRow[]);
  }

  // 검색어와 매칭되는 공식 대회. 한글 도시만 보면 "Incheon" 으로는 못 찾으므로
  // 영문 도시(city_en)까지 함께 매칭한다. 이미 선택했으면 목록을 숨긴다.
  const term = title.trim().toLowerCase();
  const matches =
    !eventId && term.length >= 1 && events
      ? events.filter((e) => [e.name, e.city, e.city_en ?? ""].some((v) => v.toLowerCase().includes(term))).slice(0, 8)
      : [];

  function pickEvent(e: RaceEventRow) {
    setTitle(`${e.name} · ${e.city}`);
    if (e.start_date) setDate(e.start_date);
    setEventId(e.id);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !date || !bibOk(bib)) return;
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      setBusy(false);
      return;
    }
    const { error } = await supabase.from("race_plans").insert({
      user_id: u.user.id,
      title: title.trim(),
      race_date: date,
      race_event_id: eventId,
      division: division.trim() || null,
      bib: bib.trim() || null,
      note: note.trim() || null,
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setTitle("");
    setDate("");
    setDivision("");
    setBib("");
    setNote("");
    setEventId(null);
    setOpen(false);
    router.refresh();
  }

  const showTrigger = part !== "list";
  const showList = part !== "trigger";
  // 상세에서 "뒤로"가 온 곳을 가리키도록 현재 경로를 실어 보낸다.
  // 같은 목록이 내 일정과 크루 일정 두 곳에 있어서, 상세는 어디서 왔는지
  // 스스로 알 수 없다.
  const planHref = (id: string) => `/schedule/race/${id}?from=${encodeURIComponent(pathname)}`;
  const dateLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(tag, { month: "long", day: "numeric", weekday: "short" });

  return (
    <>
      {showTrigger && (
        <>
          <Button type="button" variant="outline" onClick={openForm}>
            <Plus size={16} />
            {t("crew.racePlanAdd")}
          </Button>
          {/* 등록 폼은 입력이 여러 줄이라 툴바 칸에서는 눌린다 — RoxDialog 로 띄운다 */}
          <RoxDialog open={open} onOpenChange={setOpen} title={t("crew.racePlanAdd")}>
            {open && (
              <form onSubmit={save}>
                <RacePlanFields
                  {...{ title, setTitle, date, setDate, division, setDivision, bib, setBib, note, setNote }}
                  titleField={
                    <>
                      {/* 공식 대회 검색 — 자유 입력처럼 보이면 검색 기능을 아무도 못 찾는다.
                          라벨과 안내로 "검색해서 고르는 칸"임을 드러낸다. */}
                      <Field label={t("crew.racePlanSearch")}>
                        <Input
                          value={title}
                          onChange={(e) => {
                            setTitle(e.target.value);
                            setEventId(null); // 직접 수정하면 공식 대회 연결 해제
                          }}
                          placeholder={t("crew.racePlanTitlePh")}
                          maxLength={80}
                          autoComplete="off"
                          required
                        />
                      </Field>
                      {matches.length > 0 && (
                        <div className="rx-actions" style={{ marginTop: 0, flexDirection: "column", alignItems: "stretch", gap: 2 }}>
                          {matches.map((ev) => (
                            <Button key={ev.id} type="button" variant="ghost" size="sm" onClick={() => pickEvent(ev)} style={{ justifyContent: "flex-start" }}>
                              <b>{ev.name}</b>
                              <span className="rx-muted">{ev.city}</span>
                              {ev.start_date && <span className="rx-muted">{ev.start_date}</span>}
                            </Button>
                          ))}
                        </div>
                      )}
                      {eventId ? (
                        <Hint>✓ {t("crew.racePlanLinked")}</Hint>
                      ) : (
                        title.trim().length >= 1 && events !== null && matches.length === 0 && <Hint>{t("crew.racePlanNoMatch")}</Hint>
                      )}
                    </>
                  }
                />
                {err && (
                  <p role="alert" className="rx-error">
                    {err}
                  </p>
                )}
                <div className="rx-actions">
                  <Button type="submit" className="rx-primary" disabled={busy || !title.trim() || !date || !bibOk(bib)}>
                    {busy ? t("common.saving") : t("common.save")}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                    {t("common.cancel")}
                  </Button>
                </div>
              </form>
            )}
          </RoxDialog>
        </>
      )}
      {showList &&
        myPlans.map((p) => {
          const d = Math.round((Date.parse(p.race_date) - Date.parse(today)) / 86400000);
          const partnerNote = p.partners.map((pt) => `${pt.name}${pt.status === "accepted" ? " ✓" : pt.status === "declined" ? " ✕" : ""}`).join(", ");
          const note = [
            dateLabel(p.race_date),
            p.division ? dictLabel(t, `division.${p.division}`, p.division) : null,
            p.bib ? `BIB ${p.bib}` : null,
            p.role === "partner" ? t("race.byOwner", { name: p.owner_name }) : partnerNote || null,
            p.goal_target_ms == null ? t("race.goalNone") : `${t("race.goalTitle")} ${fmtMs(p.goal_target_ms)}`,
          ]
            .filter(Boolean)
            .join(" · ");
          const end = p.role === "partner" && p.my_status === "pending" ? <Chip tone="yellow">{t("race.partnerRespond")}</Chip> : d >= 0 ? `D–${d}` : t("race.past");
          return <RecordRow key={p.id} href={planHref(p.id)} title={p.title} note={note} end={end} />;
        })}
    </>
  );
}

/** 모임 참석 체크 — going/maybe/declined 업서트. 멤버만 (RLS is_crew_member).
 *  시안 CrewSchedule 상세의 "내 참석 여부" Segments(참석·미정·불참) 그대로. */
export function CrewRsvpButtons({
  eventId,
  myStatus,
  closed = false,
}: {
  eventId: string;
  myStatus: string | null;
  /** 종료된 모임은 응답을 바꿀 수 없다 (최종 차단은 DB RLS) */
  closed?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function set(status: "going" | "maybe" | "declined") {
    if (busy || closed) return;
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      setBusy(false);
      return;
    }
    const { error } = await supabase.from("crew_event_rsvps").upsert({ event_id: eventId, user_id: u.user.id, status }, { onConflict: "event_id,user_id" });
    setBusy(false);
    if (error) setErr(error.message);
    else router.refresh();
  }

  // 정원 초과로 참석 신청이 대기로 전환된 상태 — 참석 칸을 대기로 표시
  const waitlisted = myStatus === "waitlisted";
  const value = waitlisted ? "going" : (myStatus ?? "");
  const label = (s: string) => t(s === "going" ? "crew.rsvpGoing" : s === "maybe" ? "crew.rsvpMaybe" : s === "declined" ? "crew.rsvpDeclined" : "crew.rsvpNone");

  return (
    <div aria-busy={busy} style={closed ? { opacity: 0.6, pointerEvents: "none" } : undefined}>
      <Segments
        label={t("crew.rsvpSummary")}
        value={value}
        onChange={(v) => set(v as "going" | "maybe" | "declined")}
        options={[
          ["going", waitlisted ? `⏳ ${t("crew.rsvpWaitlisted")}` : t("crew.rsvpGoing")],
          ["maybe", t("crew.rsvpMaybe")],
          ["declined", t("crew.rsvpDeclined")],
        ]}
      />
      <Hint>{t("crew.rsvpNow", { v: waitlisted ? t("crew.rsvpWaitlisted") : label(value) })}</Hint>
      {waitlisted && <Hint>{t("crew.waitlistNote")}</Hint>}
      {err && (
        <p role="alert" className="rx-error">
          {err}
        </p>
      )}
    </div>
  );
}

/** 모임 상세 우측 상단 "⋯" 드롭다운 — 장부 행 메뉴(RowMenu)와 같은 모양. */
export function CrewEventMoreMenu({ label, children }: { label: string; children: React.ReactNode }) {
  return <RowMenu label={label}>{children}</RowMenu>;
}

/**
 * 모임 상세의 운영진 액션 묶음 — ⋯ 메뉴에 수정·종료·취소를 모은다.
 * 수정 폼은 입력이 여러 줄이라 메뉴 안에서는 눌린다 — CrewMeetupForm 이 RoxDialog 로 띄운다.
 */
export function CrewEventStaffActions({
  event,
  children,
}: {
  event: MeetupEditable;
  /** 종료/해제 · 취소 등 나머지 메뉴 항목 */
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const [edit, setEdit] = useState(false);

  return (
    <>
      <CrewEventMoreMenu label={t("crew.eventSettings")}>
        <Button type="button" variant="ghost" size="sm" onClick={() => setEdit(true)}>
          {t("common.edit")}
        </Button>
        {children}
      </CrewEventMoreMenu>
      {edit && <CrewMeetupForm event={event} open onOpenChange={setEdit} />}
    </>
  );
}

/** 모임 댓글 입력 — 크루원 전용, 댓글 허용 모임에만 렌더된다.
 *  권한(멤버·comments_allowed·members_only)은 RLS 가 최종 강제.
 *  시안 CrewSchedule 상세의 댓글 줄(.rx-actions[Input · Button]) 그대로. */
export function CrewEventCommentForm({
  eventId,
  myName,
}: {
  eventId: string;
  /** 입력 줄 좌측 아바타용 — 서버가 내 표시 이름을 넘겨준다 */
  myName: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      setBusy(false);
      return setErr(t("common.needLogin"));
    }
    const { error } = await supabase.from("crew_event_comments").insert({ event_id: eventId, author_id: u.user.id, body: text });
    setBusy(false);
    if (error) return setErr(error.message);
    setBody("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="rx-actions" style={{ flexWrap: "nowrap" }}>
      <span className="rx-avatar" aria-hidden>
        {(myName.trim()[0] ?? "?").toUpperCase()}
      </span>
      <Input aria-label={t("crew.commentPlaceholder")} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("crew.commentPlaceholder")} maxLength={500} />
      <Button type="submit" className="rx-primary" disabled={busy || !body.trim()}>
        {t("crew.commentSubmit")}
      </Button>
      {err && (
        <span role="alert" className="rx-error">
          {err}
        </span>
      )}
    </form>
  );
}

/** 모임 취소 — 스태프 전용 soft cancel. ⋯ 메뉴 항목. */
export function CrewMeetupCancel({ eventId, slug }: { eventId: string; slug: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function cancel() {
    if (!window.confirm(t("crew.meetupCancelConfirm"))) return;
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase.from("crew_events").update({ cancelled_at: new Date().toISOString() }).eq("id", eventId);
    setBusy(false);
    if (error) return setErr(error.message);
    router.push(`/crews/${slug}/schedule`);
    router.refresh();
  }

  return (
    <>
      <Button type="button" variant="ghost" size="sm" className="rx-pft-close" onClick={cancel} disabled={busy}>
        {t("crew.meetupCancel")}
      </Button>
      {err && <span className="rx-error">{err}</span>}
    </>
  );
}

export type AttendanceRow = {
  user_id: string;
  display_name: string;
  /** 운영진에게만 내려온다 — 일반 크루원에게는 null (RPC 가 게이트) */
  email: string | null;
  role: "owner" | "coach" | "member" | "associate";
  rsvp_status: string | null;
  checked_in: boolean;
  /** 이 모임의 회차비 청구 (운영진에게만). 무료 행사·회차비 없는 등급이면 null */
  charge_id: string | null;
  charge_amount: number | null;
  charge_status: "pending" | "reported" | "confirmed" | "waived" | null;
};

/**
 * 출석자 인스타 핸들 복사 — 모임 사진에 태그할 때 한 줄로 붙여 넣는다.
 *
 * 핸들은 누를 때 가져온다(목록에 늘 실어 나를 이유가 없다). 핸들을 적어 두지
 * 않은 사람이 있으면 몇 명이 빠졌는지 함께 알려 준다 — 조용히 빼면 태그가
 * 누락된 걸 나중에 알게 된다.
 */
export function CrewEventInstaCopy({ eventId }: { eventId: string }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function copy() {
    setBusy(true);
    setNote(null);
    const { data, error } = await createClient().rpc("crew_event_instagrams", { p_event: eventId });
    setBusy(false);
    if (error) return setNote(error.message);
    const rows = (data ?? []) as { display_name: string; instagram: string | null }[];
    const handles = rows
      .map((r) => r.instagram)
      .filter((h): h is string => !!h)
      .map((h) => `@${h.replace(/^@/, "")}`);
    if (!handles.length) return setNote(t("crew.instaNone"));
    try {
      await navigator.clipboard.writeText(handles.join(" "));
    } catch {
      window.prompt(t("crew.shareCopyManual"), handles.join(" "));
      return;
    }
    const missing = rows.length - handles.length;
    setNote(missing > 0 ? t("crew.instaCopiedSome", { n: handles.length, missing }) : t("crew.instaCopied", { n: handles.length }));
    window.setTimeout(() => setNote(null), 4000);
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={copy} disabled={busy}>
        {t("crew.instaCopy")}
      </Button>
      {note && <span className="rx-muted">{note}</span>}
    </>
  );
}

export type GoingEntry = { name: string; tier: string | null; color: string | null };

/** 참석 명단 카드의 탭. 출석(실제로 온 사람) + 응답별 명단 네 가지. */
type RsvpTab = "attend" | "going" | "maybe" | "declined" | "none";

/**
 * 참석 명단 · 출석 체크 통합 카드 — 시안에 없는 화면(§4).
 * Panel[ Segments(탭) · Hint · DataTable[.rx-person · 회차비 · 출석] · Empty ] 로만 그린다.
 *
 * 두 목록은 서로 다른 것을 본다 — 명단은 "오겠다고 한 사람"(RSVP), 출석은
 * "실제로 온 사람"이다. 둘을 한 카드의 탭으로 묶되 섞지 않는다.
 * 출석 토글 권한은 crew_event_check_in RPC 가 강제한다.
 */
export function CrewAttendanceCheck({
  eventId,
  rows,
  going,
  canEdit,
  started,
  memberCount,
  waitlistNames,
  feeExempt,
  settings,
}: {
  eventId: string;
  rows: AttendanceRow[];
  /** 참석 명단 탭 — 등급 배지가 붙는다 (crew_event_detail 이 채워 준다) */
  going: GoingEntry[];
  canEdit: boolean;
  /** 모임이 이미 시작했는지. 시작 전에는 "아직 안 옴"이지 불참이 아니다.
   *  렌더 중에 Date.now() 를 부르면 순수하지 않으므로 서버에서 판정해 받는다. */
  started: boolean;
  memberCount: number;
  waitlistNames: string[];
  feeExempt: boolean;
  /** 운영진 모임 설정 토글 (CrewEventFeeToggle) — 서버에서 꽂아 준다 */
  settings?: React.ReactNode;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  // 모임이 시작했으면 출석 체크가, 아니면 참석 명단이 볼 일이다.
  const [tab, setTab] = useState<RsvpTab>(started ? "attend" : "going");

  async function toggle(userId: string, present: boolean) {
    setBusy(userId);
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("crew_event_check_in", { p_event: eventId, p_user: userId, p_present: present });
    setBusy(null);
    if (error) setErr(duesErrText(t, error.message));
    else router.refresh();
  }

  /** 참석자 전원 출석 — 정기 모임에서 한 명씩 누르는 게 대부분 낭비다.
   *  이미 체크된 사람은 건너뛰고, 한 건이라도 실패하면 거기서 멈추고 알린다. */
  async function checkAllGoing() {
    const targets = rows.filter((r) => !r.checked_in && (r.rsvp_status === "going" || r.rsvp_status === "waitlisted"));
    if (!targets.length) return;
    if (!window.confirm(t("crew.checkAllConfirm", { n: targets.length }))) return;
    setBusy("all");
    setErr(null);
    const supabase = createClient();
    for (const r of targets) {
      const { error } = await supabase.rpc("crew_event_check_in", { p_event: eventId, p_user: r.user_id, p_present: true });
      if (error) {
        setBusy(null);
        setErr(duesErrText(t, error.message));
        router.refresh();
        return;
      }
    }
    setBusy(null);
    router.refresh();
  }

  /** 회차비 확정/해제 — 현장에서 돈을 받고 바로 처리할 수 있게 출석 옆에 둔다.
   *  회계 탭의 확정 보드와 같은 RPC 라 어느 쪽에서 해도 결과가 같다. */
  async function settle(chargeId: string, confirmed: boolean) {
    setBusy(chargeId);
    setErr(null);
    const { error } = await createClient().rpc(confirmed ? "unconfirm_dues_charge" : "confirm_dues_charge", { p_charge: chargeId });
    setBusy(null);
    if (error) setErr(duesErrText(t, error.message));
    else router.refresh();
  }

  // 응답별 명단. crew_event_attendance 는 활성 크루원 **전원**을 rsvp 와 left join 해
  // 주므로(무응답은 status 가 null) 미정·불참·무응답 명단이 추가 조회 없이 나온다.
  const maybeRows = rows.filter((r) => r.rsvp_status === "maybe");
  const declinedRows = rows.filter((r) => r.rsvp_status === "declined");
  const noneRows = rows.filter((r) => !r.rsvp_status);

  const present = rows.filter((r) => r.checked_in);
  // 불참 = 참석하겠다고 해 놓고 출석 체크가 안 된 사람. 모임이 시작하기
  // 전에는 아직 안 온 것일 뿐이라 불참으로 세지 않는다.
  const noShow = rows.filter((r) => !r.checked_in && (r.rsvp_status === "going" || r.rsvp_status === "waitlisted"));

  // 출석 탭 기본은 참석 신청자 + 이미 체크된 사람. 나머지 크루원은 접어 둔다 —
  // 워크인 체크가 필요할 때만 펼치면 된다.
  const rsvpd = rows.filter((r) => r.checked_in || r.rsvp_status === "going" || r.rsvp_status === "waitlisted");
  const rest = rows.filter((r) => !rsvpd.includes(r));
  const shown = showAll ? [...rsvpd, ...rest] : rsvpd;

  // 이 모임의 회차비 현황 — 현장에서 얼마 받았고 얼마 남았는지
  const due = rows.filter((r) => r.charge_id && (r.charge_status === "pending" || r.charge_status === "reported"));
  const paidSum = rows.filter((r) => r.charge_status === "confirmed").reduce((a, r) => a + (r.charge_amount ?? 0), 0);
  const dueSum = due.reduce((a, r) => a + (r.charge_amount ?? 0), 0);

  const rsvpChip = (status: string | null) => {
    if (status === "going") return <Chip tone="green">{t("crew.rsvpGoing")}</Chip>;
    if (status === "waitlisted") return <Chip tone="yellow">{t("crew.rsvpWaitlisted")}</Chip>;
    if (status === "maybe") return <Chip tone="blue">{t("crew.rsvpMaybe")}</Chip>;
    if (status === "declined") return <Chip tone="red">{t("crew.rsvpDeclined")}</Chip>;
    return <Chip>{t("crew.rsvpNone")}</Chip>;
  };
  const roleChip = (r: AttendanceRow) => (isStaffRole(r.role) ? <Chip tone={crewRoleChipTone(r.role)}>{t(crewRoleDictKey(r.role))}</Chip> : undefined);

  const tabNote =
    tab === "attend"
      ? feeExempt
        ? t("crew.feeExemptNote")
        : t("crew.attendTabNote")
      : tab === "going"
        ? t("crew.goingListNote")
        : tab === "maybe"
          ? t("crew.maybeListNote")
          : tab === "declined"
            ? t("crew.declinedListNote")
            : t("crew.noneListNote");
  const listRows = tab === "maybe" ? maybeRows : tab === "declined" ? declinedRows : noneRows;

  return (
    <Panel
      title={t("crew.goingList")}
      action={
        settings ? (
          <span className="rx-actions" style={{ marginTop: 0 }}>
            <span className="rx-muted">{t("crew.eventSettings")}</span>
            {settings}
          </span>
        ) : undefined
      }
    >
      <div className="rx-toolbar">
        {/* 크루원도 탭을 다 본다 — 출석 탭이 읽기 전용일 뿐이다 */}
        <Segments
          label={t("crew.goingList")}
          value={tab}
          onChange={(v) => setTab(v as RsvpTab)}
          options={[
            ["attend", `${t("crew.attendCheckTab")} ${present.length}`],
            ["going", `${t("crew.rsvpGoing")} ${going.length}`],
            ["maybe", `${t("crew.rsvpMaybe")} ${maybeRows.length}`],
            ["declined", `${t("crew.rsvpDeclined")} ${declinedRows.length}`],
            ["none", `${t("crew.rsvpNone")} ${noneRows.length}`],
          ]}
        />
        {tab === "attend" && (canEdit || present.length > 0) && (
          <span className="rx-actions" style={{ marginTop: 0 }}>
            {canEdit && noShow.length > 0 && (
              <Button type="button" variant="outline" size="sm" onClick={checkAllGoing} disabled={busy != null}>
                {t("crew.checkAllGoing")}
              </Button>
            )}
            {present.length > 0 && <CrewEventInstaCopy eventId={eventId} />}
          </span>
        )}
      </div>

      <Hint>
        {tabNote}
        {/* 출석 집계는 출석 탭에서만 — 응답 명단 탭에서는 다른 이야기다 */}
        {canEdit && tab === "attend" && (
          <>
            {" · "}
            {t("crew.attendCounted", { n: present.length, total: memberCount || rows.length })}
            {started && noShow.length > 0 && <span className="rx-error"> {t("crew.attendNoShow", { n: noShow.length })}</span>}
          </>
        )}
      </Hint>

      {/* 회차비 수납 요약 — 운영진만, 청구가 있을 때만 */}
      {canEdit && (paidSum > 0 || dueSum > 0) && (
        <p>
          <span className="rx-muted">{t("crew.attendFeeTitle")} </span>
          <strong className="rx-income">{won(paidSum)}</strong>
          <span className="rx-muted"> · </span>
          <strong className="rx-expense">{won(dueSum)}</strong>
          <span className="rx-muted"> {t("crew.attendFeeDue")}</span>
        </p>
      )}

      {err && (
        <p role="alert" className="rx-error">
          {err}
        </p>
      )}

      {tab === "attend" ? (
        /* 출석 체크 탭 — 운영진은 토글, 크루원은 읽기 전용 */
        <>
          {shown.length > 0 ? (
            <DataTable
              headers={[t("crew.colMember"), canEdit ? t("crew.eventFee") : "", t("crew.attendCheckTab")]}
              rows={shown.map((r) => [
                <Person key="p" name={r.display_name} note={rsvpChip(r.rsvp_status)} chip={roleChip(r)} />,
                // 회차비 — 청구가 있을 때만. 무료 행사·회차비 없는 등급은 안 뜬다
                canEdit && r.charge_id && r.charge_amount != null ? (
                  r.charge_status === "waived" ? (
                    <Chip key="f" tone="blue">
                      {t("crew.duesWaived")}
                    </Chip>
                  ) : (
                    <Button key="f" type="button" size="sm" variant={r.charge_status === "confirmed" ? "default" : "outline"} className={r.charge_status === "confirmed" ? "rx-primary" : ""} disabled={busy != null} onClick={() => settle(r.charge_id!, r.charge_status === "confirmed")}>
                      {r.charge_status === "confirmed" ? "✓ " : ""}
                      {won(r.charge_amount)}
                    </Button>
                  )
                ) : (
                  <span key="f" />
                ),
                canEdit ? (
                  <Button key="a" type="button" size="sm" variant={r.checked_in ? "default" : "outline"} className={r.checked_in ? "rx-primary" : ""} disabled={busy != null} onClick={() => toggle(r.user_id, !r.checked_in)}>
                    {r.checked_in ? `✓ ${t("crew.attendPresent")}` : t("crew.attendMark")}
                  </Button>
                ) : (
                  <Chip key="a" tone={r.checked_in ? "green" : "neutral"}>
                    {r.checked_in ? t("crew.attendPresent") : "—"}
                  </Chip>
                ),
              ])}
            />
          ) : (
            <Empty title={t("crew.attendNoRsvp")} description={t("crew.attendTabNote")} />
          )}
          {canEdit && rest.length > 0 && (
            <div className="rx-actions">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
                {showAll ? t("crew.attendHideOthers") : t("crew.attendShowOthers", { n: rest.length })}
              </Button>
            </div>
          )}
        </>
      ) : tab !== "going" ? (
        /* 미정 · 불참 · 무응답 명단 — 셋이 같은 모양이라 한 곳에서 그린다.
           이름을 보여 주는 게 목적이다(개수만으로는 누구에게 물어볼지 모른다). */
        listRows.length > 0 ? (
          <DataTable headers={[t("crew.colMember"), t("crew.rsvpSummary")]} rows={listRows.map((r) => [<Person key="p" name={r.display_name} chip={roleChip(r)} />, rsvpChip(r.rsvp_status)])} />
        ) : (
          <Empty title={t("crew.rsvpEmpty")} description={tabNote} />
        )
      ) : (
        /* 참석 명단 탭 — 등급 배지 (크루원에게만 채워져 온다) */
        <>
          {going.length > 0 ? (
            <DataTable
              headers={[t("crew.colMember"), t("crew.colTier")]}
              rows={going.map((g) => [<Person key="p" name={g.name} />, g.tier ? <Chip key="t" tone={tierChipTone(g.color)}>{g.tier}</Chip> : <span key="t">—</span>])}
            />
          ) : (
            <Empty title={t("crew.rsvpEmpty")} description={t("crew.goingListNote")} />
          )}
          {waitlistNames.length > 0 && (
            <Hint>
              ⏳ {t("crew.waitlistTitle")} ({waitlistNames.length}): {waitlistNames.join(", ")}
            </Hint>
          )}
        </>
      )}
    </Panel>
  );
}

/** 모임 설정 토글 — 운영진 전용. 시안 .rx-check(Checkbox + 문구) 두 줄.
 *  · 무료 행사: 켜면 그 모임의 미납 회차비를 즉시 회수하고, 끄면 그 달을 다시
 *    대사해 출석분 청구를 되살린다 (확정분은 그대로).
 *  · 정회원 전용: 켜면 정회원 권한이 없는 등급에게 모임이 아예 안 보인다.
 *    이미 신청·출석한 기록은 지우지 않는다 — 실제로 있었던 일이고, 지우면
 *    출석 통계와 회차비 청구의 근거가 사라진다. */
export function CrewEventFeeToggle({ eventId, feeExempt, membersOnly }: { eventId: string; feeExempt: boolean; membersOnly: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function toggleFee(on: boolean) {
    if (on && !window.confirm(t("crew.feeExemptConfirm"))) return;
    setBusy("fee");
    setErr(null);
    setNote(null);
    const { error } = await createClient().rpc("set_event_fee_exempt", { p_event: eventId, p_on: on });
    setBusy(null);
    if (error) setErr(duesErrText(t, error.message));
    else router.refresh();
  }

  async function toggleMembers(on: boolean) {
    if (on && !window.confirm(t("crew.fullOnlyConfirm"))) return;
    setBusy("members");
    setErr(null);
    setNote(null);
    const { data, error } = await createClient().rpc("set_event_members_only", { p_event: eventId, p_on: on });
    setBusy(null);
    if (error) return setErr(duesErrText(t, error.message));
    const hidden = (data as { hidden_from?: number } | null)?.hidden_from ?? 0;
    if (on && hidden > 0) setNote(t("crew.fullOnlyHidden", { n: hidden }));
    router.refresh();
  }

  return (
    <span className="rx-actions" style={{ marginTop: 0 }}>
      <label className="rx-check" style={{ margin: 0 }}>
        <Checkbox checked={membersOnly} disabled={busy != null} onCheckedChange={(v) => toggleMembers(v === true)} />
        <span>{t("crew.fullOnly")}</span>
      </label>
      <label className="rx-check" style={{ margin: 0 }}>
        <Checkbox checked={feeExempt} disabled={busy != null} onCheckedChange={(v) => toggleFee(v === true)} />
        <span>{t("crew.feeExempt")}</span>
      </label>
      {note && <span className="rx-muted">{note}</span>}
      {err && <span className="rx-error">{err}</span>}
    </span>
  );
}

/** 모임 링크 공유 — 외부(카톡·인스타)에서 바로 타고 들어올 수 있게.
 *  Web Share API 가 있으면 시스템 공유 시트를, 없으면 클립보드 복사로 떨어진다.
 *  공개 크루의 모임은 비로그인도 열 수 있고, 정회원 전용 모임은 열었을 때
 *  권한 검사가 걸린다(링크 자체는 비밀이 아니다). */
export function CrewEventShare({ url, title }: { url: string; title: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);

  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
    } catch {
      /* 사용자가 공유 시트를 닫은 경우 — 복사로 넘어가지 않는다 */
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setDone(true);
      window.setTimeout(() => setDone(false), 2000);
    } catch {
      window.prompt(t("crew.shareCopyManual"), url);
    }
  }

  return (
    <Button type="button" variant="outline" onClick={share}>
      {done ? t("crew.shareCopied") : t("crew.shareLink")}
    </Button>
  );
}

/** 모임 종료 — 운영진 전용. 종료하면 크루원은 참석 여부를 더 바꿀 수 없다
 *  (DB RLS 가 막는다). 취소와 달리 모임은 그대로 보이고, 운영진은 종료 뒤에도
 *  출석을 고칠 수 있다 — 종료 시점의 오타를 되돌릴 방법이 있어야 한다. ⋯ 메뉴 항목. */
export function CrewEventClose({ eventId, closed }: { eventId: string; closed: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    if (!closed && !window.confirm(t("crew.closeConfirm"))) return;
    setBusy(true);
    setErr(null);
    const { error } = await createClient().rpc("set_event_closed", { p_event: eventId, p_on: !closed });
    setBusy(false);
    if (error) setErr(duesErrText(t, error.message));
    else router.refresh();
  }

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={toggle} disabled={busy}>
        {closed ? t("crew.reopen") : t("crew.close")}
      </Button>
      {err && <span className="rx-error">{err}</span>}
    </>
  );
}

/**
 * 일정 목록용 한 버튼 참석 토글.
 * 상세의 CrewRsvpButtons(참석/미정/불참 3지선다)와 달리 목록에서는 참석 여부만
 * 빠르게 바꾼다. 참석을 끄면 응답 자체를 지운다 — 목록에서 끈 것을 "불참 선언"
 * 으로 기록하면 불참 명단이 사실과 달라진다.
 *
 * 미정·불참으로 답해 둔 경우에는 그 답을 칩으로 함께 보여준다.
 * 종료된 모임은 칩만 (최종 차단은 DB RLS).
 */
export function CrewRsvpToggle({ eventId, myStatus, closed = false }: { eventId: string; myStatus: string | null; closed?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const going = myStatus === "going";
  const waitlisted = myStatus === "waitlisted";

  async function toggle() {
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      setBusy(false);
      return;
    }
    const { error } =
      going || waitlisted
        ? await supabase.from("crew_event_rsvps").delete().eq("event_id", eventId).eq("user_id", u.user.id)
        : await supabase.from("crew_event_rsvps").upsert({ event_id: eventId, user_id: u.user.id, status: "going" }, { onConflict: "event_id,user_id" });
    setBusy(false);
    if (error) setErr(error.message);
    else router.refresh();
  }

  // 미정·불참 — 이미 답한 상태다. 무응답과 구분해서 보여준다.
  const answered = myStatus === "maybe" || myStatus === "declined";

  if (closed) {
    return <Chip>{going ? t("crew.rsvpDone") : t("crew.rsvpMissed")}</Chip>;
  }

  return (
    <span className="rx-actions" style={{ marginTop: 0, flexWrap: "nowrap" }}>
      {answered && <Chip tone={myStatus === "declined" ? "red" : "blue"}>{t(myStatus === "declined" ? "crew.rsvpDeclined" : "crew.rsvpMaybe")}</Chip>}
      <Button type="button" size="sm" variant={going || waitlisted ? "outline" : "default"} className={going || waitlisted ? "" : "rx-primary"} onClick={toggle} disabled={busy}>
        {waitlisted ? `⏳ ${t("crew.rsvpWaitlisted")}` : going ? `✓ ${t("crew.rsvpGoing")}` : t("crew.rsvpJoin")}
      </Button>
      {err && <span className="rx-error">{err}</span>}
    </span>
  );
}
