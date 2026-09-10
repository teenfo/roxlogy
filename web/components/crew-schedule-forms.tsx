"use client";

import { useRouter } from "next/navigation";
import { DIVISIONS } from "@/lib/divisions";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { dictLabel } from "@/lib/dict-label";
import { duesErrText } from "@/lib/dues-error";
import { formatMs as fmtMs } from "@/lib/format";
import { Avatar } from "@/components/ui/crew-ui";
import {
  crewRoleBadgeClass,
  crewRoleDictKey,
  isStaffRole,
  tierBadgeClass,
} from "@/lib/crew-role";

const input =
  "rounded-md border border-muted/30 bg-background px-3 py-2 text-sm outline-none focus:border-accent";

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
  const [when, setWhen] = useState(
    event ? toLocalInput(event.starts_at) : "",
  );
  const [location, setLocation] = useState(event?.location ?? "");
  const [desc, setDesc] = useState(event?.description ?? "");
  const [capacity, setCapacity] = useState(
    event?.capacity != null ? String(event.capacity) : "",
  );
  const [feeExempt, setFeeExempt] = useState(false);
  const [membersOnly, setMembersOnly] = useState(false);
  const [commentsAllowed, setCommentsAllowed] = useState(
    event?.comments_allowed ?? true,
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !when) return;
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const cap =
      /^\d+$/.test(capacity.trim()) && parseInt(capacity, 10) > 0
        ? parseInt(capacity, 10)
        : null;
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

  if (!open) {
    // 제어형이면 트리거는 부모(⋯ 메뉴)가 그린다
    if (controlled) return null;
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-accent px-3 py-1.5 text-xs font-bold text-background hover:brightness-110"
      >
        {editing ? t("common.edit") : `+ ${t("crew.meetupAdd")}`}
      </button>
    );
  }
  return (
    <form onSubmit={save} className="flex w-full flex-col gap-2 rounded-md bg-surface p-4">
      <p className="text-sm font-semibold">
        {editing ? t("crew.meetupEdit") : t("crew.meetupAdd")}
      </p>
      <input
        className={input}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("crew.meetupTitlePh")}
        maxLength={80}
      />
      <input
        type="datetime-local"
        className={input}
        value={when}
        onChange={(e) => setWhen(e.target.value)}
      />
      <input
        className={input}
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        placeholder={t("crew.meetupLocationPh")}
        maxLength={80}
      />
      <textarea
        className={`${input} min-h-16`}
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder={t("crew.meetupDescPh")}
        maxLength={1000}
      />
      <input
        className={input}
        value={capacity}
        onChange={(e) => setCapacity(e.target.value)}
        placeholder={t("crew.meetupCapacityPh")}
        inputMode="numeric"
        maxLength={4}
      />
      {!editing && (
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={membersOnly}
            onChange={(e) => setMembersOnly(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          <span>{t("crew.fullOnly")}</span>
          <span className="text-muted">{t("crew.fullOnlyMeetupHint")}</span>
        </label>
      )}
      <label className="flex cursor-pointer items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={commentsAllowed}
          onChange={(e) => setCommentsAllowed(e.target.checked)}
          className="h-4 w-4 accent-accent"
        />
        <span>{t("crew.allowComments")}</span>
      </label>
      {!editing && (
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={feeExempt}
            onChange={(e) => setFeeExempt(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          <span>{t("crew.feeExempt")}</span>
          <span className="text-muted">{t("crew.feeExemptHint")}</span>
        </label>
      )}
      {err && <p className="text-xs text-red-400">{err}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy || !title.trim() || !when}
          className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-background hover:brightness-110 disabled:opacity-40"
        >
          {editing ? t("common.save") : t("crew.meetupCreate")}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md px-3 py-2 text-sm text-muted hover:text-foreground"
        >
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}

export type MyRacePlan = {
  id: string;
  title: string;
  race_date: string;
  division: string | null;
  bib: string | null;
  note: string | null;
  goal_plan_id: string | null; // 연결된 목표(goal_plans) — 있으면 목표 세우기 버튼 숨김
  /** 연결된 목표의 스플릿. goal_plan_id 가 있으면 함께 내려온다 */
  goal: {
    target_total_ms: number;
    run_total_ms: number | null;
    station_total_ms: number | null;
    roxzone_total_ms: number | null;
  } | null;
};

/**
 * supabase 임베드 정규화 — `goal:goal_plans ( … )` 는 FK 한 건이라 런타임에는
 * 객체로 오지만 생성된 타입은 배열로 본다. 한쪽으로 맞춘다.
 */
export function normalizeRacePlans(rows: unknown): MyRacePlan[] {
  return ((rows ?? []) as (Omit<MyRacePlan, "goal"> & {
    goal: MyRacePlan["goal"] | MyRacePlan["goal"][] | null;
  })[]).map((r) => ({
    ...r,
    goal: (Array.isArray(r.goal) ? (r.goal[0] ?? null) : r.goal) ?? null,
  }));
}

const bibOk = (v: string) => v.trim() === "" || /^\d{4,8}$/.test(v.trim());

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
 *  목록에 없는 대회는 입력한 이름 그대로 등록된다. */
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
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [division, setDivision] = useState("");
  const [bib, setBib] = useState("");
  const [note, setNote] = useState("");
  const [eventId, setEventId] = useState<string | null>(null);
  const [events, setEvents] = useState<RaceEventRow[] | null>(null);
  // 인라인 수정 — BIB 는 대회 직전 발급되는 경우가 많아 나중에 채운다
  const [editId, setEditId] = useState<string | null>(null);
  const [eTitle, setETitle] = useState("");
  const [eDate, setEDate] = useState("");
  const [eDivision, setEDivision] = useState("");
  const [eBib, setEBib] = useState("");
  const [eNote, setENote] = useState("");
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
      .gte(
        "start_date",
        new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
      )
      .order("start_date", { ascending: true })
      .limit(100);
    setEvents((data ?? []) as RaceEventRow[]);
  }

  // 검색어와 매칭되는 공식 대회. 한글 도시만 보면 "Incheon" 으로는 못 찾으므로
  // 영문 도시(city_en)까지 함께 매칭한다. 이미 선택했으면 목록을 숨긴다.
  const term = title.trim().toLowerCase();
  const matches =
    !eventId && term.length >= 1 && events
      ? events
          .filter((e) =>
            [e.name, e.city, e.city_en ?? ""].some((v) =>
              v.toLowerCase().includes(term),
            ),
          )
          .slice(0, 8)
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

  function startEdit(p: MyRacePlan) {
    setEditId(p.id);
    setETitle(p.title);
    setEDate(p.race_date);
    setEDivision(p.division ?? "");
    setEBib(p.bib ?? "");
    setENote(p.note ?? "");
    setErr(null);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId || !eTitle.trim() || !eDate || !bibOk(eBib)) return;
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("race_plans")
      .update({
        title: eTitle.trim(),
        race_date: eDate,
        division: eDivision.trim() || null,
        bib: eBib.trim() || null,
        note: eNote.trim() || null,
      })
      .eq("id", editId);
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setEditId(null);
    router.refresh();
  }

  async function del(id: string) {
    if (!window.confirm(t("crew.racePlanDelConfirm"))) return;
    const supabase = createClient();
    const { error } = await supabase.from("race_plans").delete().eq("id", id);
    if (error) return setErr(error.message);
    router.refresh();
  }

  const showTrigger = part !== "list";
  const showList = part !== "trigger";

  return (
    <div className="flex flex-col gap-2">
      {showTrigger && (
        <button
          type="button"
          onClick={openForm}
          className="self-start rounded-md bg-surface px-3 py-1.5 text-xs font-semibold text-track hover:brightness-110"
        >
          + {t("crew.racePlanAdd")}
        </button>
      )}
      {showTrigger && open && (
        /* 등록 폼은 입력이 여러 줄이라 툴바 칸에서는 눌린다 — 오버레이로 띄운다 */
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-10"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg text-left"
            onClick={(e) => e.stopPropagation()}
          >
        <form onSubmit={save} className="flex w-full flex-col gap-2 rounded-md bg-surface p-4">
          <p className="text-sm font-semibold">{t("crew.racePlanAdd")}</p>
          {/* 공식 대회 검색 — 자유 입력처럼 보이면 검색 기능을 아무도 못 찾는다.
              라벨과 안내로 "검색해서 고르는 칸"임을 드러낸다. */}
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t("crew.racePlanSearch")}
            <input
              className={input}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setEventId(null); // 직접 수정하면 공식 대회 연결 해제
              }}
              placeholder={t("crew.racePlanTitlePh")}
              maxLength={80}
              autoComplete="off"
            />
          </label>
          {matches.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-md bg-background p-2">
              {matches.map((ev) => (
                <li key={ev.id}>
                  <button
                    type="button"
                    onClick={() => pickEvent(ev)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-surface"
                  >
                    <span className="truncate font-semibold">{ev.name}</span>
                    <span className="text-muted">{ev.city}</span>
                    {ev.start_date && (
                      <span className="ml-auto shrink-0 font-mono text-muted">
                        {ev.start_date}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {eventId ? (
            <p className="text-xs text-track">✓ {t("crew.racePlanLinked")}</p>
          ) : (
            title.trim().length >= 1 &&
            events !== null &&
            matches.length === 0 && (
              <p className="text-xs text-muted">{t("crew.racePlanNoMatch")}</p>
            )
          )}
          <input
            type="date"
            className={input}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <div className="flex gap-2">
            <select
              className={input}
              value={division}
              onChange={(e) => setDivision(e.target.value)}
            >
              <option value="">{t("crew.racePlanDivisionPh")}</option>
              {DIVISIONS.map((d) => (
                <option key={d} value={d}>
                  {t(`division.${d}` as Parameters<typeof t>[0])}
                </option>
              ))}
            </select>
            <input
              className={input}
              value={bib}
              onChange={(e) => setBib(e.target.value)}
              placeholder={t("crew.racePlanBibPh")}
              maxLength={8}
              inputMode="numeric"
            />
          </div>
          <p className="text-xs text-muted">{t("crew.racePlanBibHint")}</p>
          <input
            className={input}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("crew.racePlanNotePh")}
            maxLength={80}
          />
          {err && <p className="text-xs text-red-400">{err}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !title.trim() || !date}
              className="rounded-md bg-track px-4 py-2 text-sm font-bold text-background disabled:opacity-40"
            >
              {t("common.save")}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md px-3 py-2 text-sm text-muted hover:text-foreground"
            >
              {t("common.cancel")}
            </button>
          </div>
        </form>
          </div>
        </div>
      )}
      {showList && myPlans.length > 0 && (
        <ul className="flex flex-col gap-1">
          {myPlans.map((p) =>
            editId === p.id ? (
              <li key={p.id}>
                <form
                  onSubmit={saveEdit}
                  className="flex flex-col gap-2 rounded-md bg-surface p-3 ring-1 ring-accent/40"
                >
                  <input
                    className={input}
                    value={eTitle}
                    onChange={(e) => setETitle(e.target.value)}
                    placeholder={t("crew.racePlanTitlePh")}
                    maxLength={80}
                  />
                  <input
                    type="date"
                    className={input}
                    value={eDate}
                    onChange={(e) => setEDate(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <select
                      className={input}
                      value={eDivision}
                      onChange={(e) => setEDivision(e.target.value)}
                    >
                      <option value="">{t("crew.racePlanDivisionPh")}</option>
                      {DIVISIONS.map((d) => (
                        <option key={d} value={d}>
                          {t(`division.${d}` as Parameters<typeof t>[0])}
                        </option>
                      ))}
                    </select>
                    <input
                      className={input}
                      value={eBib}
                      onChange={(e) => setEBib(e.target.value)}
                      placeholder={t("crew.racePlanBibPh")}
                      maxLength={8}
                      inputMode="numeric"
                    />
                  </div>
                  <input
                    className={input}
                    value={eNote}
                    onChange={(e) => setENote(e.target.value)}
                    placeholder={t("crew.racePlanNotePh")}
                    maxLength={80}
                  />
                  {err && <p className="text-xs text-red-400">{err}</p>}
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={busy || !eTitle.trim() || !eDate || !bibOk(eBib)}
                      className="rounded-md bg-track px-4 py-1.5 text-xs font-bold text-background disabled:opacity-40"
                    >
                      {t("common.save")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditId(null)}
                      className="rounded-md px-3 py-1.5 text-xs text-muted hover:text-foreground"
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                </form>
              </li>
            ) : (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-dashed border-line-strong px-4 py-3 text-[13px] text-muted"
              >
                <span className="shrink-0 rounded-md border border-line-accent px-2 py-0.5 text-[10px] font-extrabold tracking-[0.06em] text-accent">
                  MY RACE
                </span>
                <span className="truncate text-[15px] font-bold text-foreground">
                  {p.title}
                </span>
                <span className="tabular shrink-0">{p.race_date}</span>
                {/* D-day — 남은 날이 보여야 준비 상태가 가늠된다 */}
                {(() => {
                  const d = Math.round(
                    (Date.parse(p.race_date) - Date.parse(today)) / 86400000,
                  );
                  if (d < 0) return null;
                  return (
                    <span className="tabular shrink-0 rounded-md bg-line px-2 py-0.5 text-[11px] font-bold text-foreground/80">
                      D-{d}
                    </span>
                  );
                })()}
                {p.division && (
                  <span className="min-w-0 truncate">
                    {dictLabel(t, `division.${p.division}`, p.division)}
                  </span>
                )}
                {p.bib && (
                  <span className="tabular shrink-0 rounded-md bg-info-bg px-2 py-0.5 text-[10px] font-bold text-info">
                    BIB {p.bib}
                  </span>
                )}
                {p.goal ? (
                  <a
                    href="/goals"
                    className="tabular shrink-0 rounded-md border border-line-accent bg-highlight px-2 py-0.5 text-[11px] font-bold text-accent"
                  >
                    🎯 {fmtMs(p.goal.target_total_ms)}
                  </a>
                ) : (
                  <a
                    href={`/predict?event=${encodeURIComponent(p.title)}&date=${p.race_date}`}
                    className="shrink-0 text-accent hover:underline"
                  >
                    {t("events.setGoal")}
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => startEdit(p)}
                  className="ml-auto text-muted hover:text-accent"
                >
                  {t("common.edit")}
                </button>
                <button
                  type="button"
                  onClick={() => del(p.id)}
                  className="text-muted hover:text-danger"
                  aria-label={t("common.delete")}
                >
                  ✕
                </button>
                {/* 목표 스플릿 — 총 기록만으로는 어디를 줄일지 안 보인다 */}
                {p.goal &&
                  (p.goal.run_total_ms != null ||
                    p.goal.station_total_ms != null) && (
                    <span className="tabular flex w-full flex-wrap gap-x-3 text-[11px] text-muted">
                      {p.goal.run_total_ms != null && (
                        <span>
                          {t("landing.m.run")} {fmtMs(p.goal.run_total_ms)}
                        </span>
                      )}
                      {p.goal.station_total_ms != null && (
                        <span>
                          {t("landing.m.station")}{" "}
                          {fmtMs(p.goal.station_total_ms)}
                        </span>
                      )}
                      {p.goal.roxzone_total_ms != null && (
                        <span>
                          {t("landing.m.roxzone")}{" "}
                          {fmtMs(p.goal.roxzone_total_ms)}
                        </span>
                      )}
                    </span>
                  )}
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

/** 모임 참석 체크 — going/maybe/declined 업서트. 멤버만 (RLS is_crew_member). */
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
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      setBusy(false);
      return;
    }
    const { error } = await supabase
      .from("crew_event_rsvps")
      .upsert(
        { event_id: eventId, user_id: u.user.id, status },
        { onConflict: "event_id,user_id" },
      );
    setBusy(false);
    if (error) setErr(error.message);
    else router.refresh();
  }

  // 정원 초과로 참석 신청이 대기로 전환된 상태 — 참석 버튼을 대기 스타일로
  const waitlisted = myStatus === "waitlisted";
  const opts = [
    ["going", waitlisted ? `⏳ ${t("crew.rsvpWaitlisted")}` : t("crew.rsvpGoing")],
    ["maybe", t("crew.rsvpMaybe")],
    ["declined", t("crew.rsvpDeclined")],
  ] as const;

  // 상태별 색을 유지한다 — "불참"이 선택됐다고 옐로로 칠하면 뜻이 뒤집힌다.
  const activeCls: Record<string, string> = {
    going: "bg-accent text-background",
    maybe: "bg-accent-dim/20 text-accent-dim ring-1 ring-accent-dim/40",
    declined: "bg-danger-bg text-danger ring-1 ring-danger-line-strong",
  };

  return (
    <div>
      <div className="grid grid-cols-3 gap-1.5">
        {opts.map(([v, label]) => {
          const on = myStatus === v || (v === "going" && waitlisted);
          return (
            <button
              key={v}
              type="button"
              disabled={busy || closed}
              onClick={() => set(v)}
              className={`flex h-10 items-center justify-center rounded-lg px-2 text-sm font-bold transition-colors disabled:opacity-50 ${
                on
                  ? waitlisted && v === "going"
                    ? "bg-accent/25 text-accent ring-1 ring-accent/50"
                    : activeCls[v]
                  : "border border-line-mid bg-control text-foreground/75 hover:border-[#555] hover:text-foreground"
              }`}
            >
              {on && v === "going" && !waitlisted ? `✓ ${label}` : label}
            </button>
          );
        })}
      </div>
      {waitlisted && (
        <p className="mt-2 text-xs text-accent">{t("crew.waitlistNote")}</p>
      )}
      {err && <p className="mt-2 text-xs text-danger">{err}</p>}
    </div>
  );
}

/** 모임 상세 우측 상단 "⋯" 드롭다운. 종료·취소처럼 자주 쓰지 않는 운영진
 *  액션을 히어로 밖으로 내보내되 한 번의 클릭 거리에 둔다. */
export function CrewEventMoreMenu({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-line-strong bg-control text-muted transition-colors hover:border-[#555] hover:text-foreground"
      >
        ⋯
      </button>
      {open && (
        <div
          // 항목을 고르면 닫는다 — 메뉴가 열린 채로 남으면 뒤에서 뭐가
          // 바뀌었는지 안 보인다
          onClick={() => setOpen(false)}
          className="absolute right-0 top-10 z-40 flex w-44 flex-col gap-0.5 rounded-[10px] border border-line-strong bg-control p-1.5 shadow-[0_12px_30px_rgba(0,0,0,.5)]"
        >
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * 모임 상세의 운영진 액션 묶음 — ⋯ 메뉴에 수정·종료·취소를 모은다.
 *
 * 수정 폼은 입력이 여러 줄이라 메뉴 안이나 히어로 우측 칸에 그리면 눌린다.
 * 열면 화면 가운데 오버레이로 띄운다.
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

  useEffect(() => {
    if (!edit) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEdit(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [edit]);

  return (
    <>
      <CrewEventMoreMenu label={t("crew.eventSettings")}>
        <button
          type="button"
          onClick={() => setEdit(true)}
          className="w-full rounded-lg px-3 py-2 text-left text-[13px] transition-colors hover:bg-card-hover"
        >
          {t("common.edit")}
        </button>
        {children}
      </CrewEventMoreMenu>

      {edit && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-10"
          onClick={() => setEdit(false)}
        >
          <div
            className="w-full max-w-lg text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <CrewMeetupForm event={event} open onOpenChange={setEdit} />
          </div>
        </div>
      )}
    </>
  );
}

/** 모임 댓글 입력 — 크루원 전용, 댓글 허용 모임에만 렌더된다.
 *  권한(멤버·comments_allowed·members_only)은 RLS 가 최종 강제. */
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
    const { error } = await supabase
      .from("crew_event_comments")
      .insert({ event_id: eventId, author_id: u.user.id, body: text });
    setBusy(false);
    if (error) return setErr(error.message);
    setBody("");
    router.refresh();
  }

  return (
    <>
      <form
        onSubmit={submit}
        className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-start gap-2.5 max-sm:grid-cols-[32px_minmax(0,1fr)_auto]"
      >
        <Avatar name={myName} size={36} className="max-sm:h-8 max-sm:w-8" />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("crew.commentPlaceholder")}
          maxLength={500}
          rows={2}
          className="w-full min-w-0 resize-y rounded-lg border border-line-strong bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-accent"
        />
        <button
          type="submit"
          disabled={busy || !body.trim()}
          className="flex h-10 shrink-0 items-center rounded-lg bg-accent px-4 text-sm font-extrabold text-background transition hover:brightness-110 disabled:opacity-40"
        >
          {t("crew.commentSubmit")}
        </button>
      </form>
      {err && <p className="mt-1 text-xs text-danger">{err}</p>}
    </>
  );
}

/** 모임 취소 — 스태프 전용 soft cancel. */
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
    const { error } = await supabase
      .from("crew_events")
      .update({ cancelled_at: new Date().toISOString() })
      .eq("id", eventId);
    setBusy(false);
    if (error) return setErr(error.message);
    router.push(`/crews/${slug}/schedule`);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={cancel}
        disabled={busy}
        className="w-full rounded-lg px-3 py-2 text-left text-[13px] text-danger transition-colors hover:bg-danger-card disabled:opacity-50"
      >
        {t("crew.meetupCancel")}
      </button>
      {err && <span className="px-3 text-[11px] text-danger">{err}</span>}
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

/** 모임 출석 체크 — 운영진만 토글할 수 있다(권한은 crew_event_check_in RPC 가 강제).
 *  RSVP(오겠다)와 출석(실제로 왔다)은 별개라, 신청하지 않은 워크인도 체크된다. */
const won = (n: number) => `₩${n.toLocaleString("ko-KR")}`;

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
    const { data, error } = await createClient().rpc("crew_event_instagrams", {
      p_event: eventId,
    });
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
    setNote(
      missing > 0
        ? t("crew.instaCopiedSome", { n: handles.length, missing })
        : t("crew.instaCopied", { n: handles.length }),
    );
    window.setTimeout(() => setNote(null), 4000);
  }

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        onClick={copy}
        disabled={busy}
        className="flex h-8 items-center rounded-lg border border-line-strong bg-control px-3 text-[13px] font-semibold transition-colors hover:border-[#555] disabled:opacity-40"
      >
        {t("crew.instaCopy")}
      </button>
      {note && <span className="text-[11px] text-muted">{note}</span>}
    </span>
  );
}

export type GoingEntry = { name: string; tier: string | null; color: string | null };

/**
 * 참석 명단 · 출석 체크 통합 카드 (2026-09 핸드오프).
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
  const [tab, setTab] = useState<"attend" | "going">(
    started ? "attend" : "going",
  );

  async function toggle(userId: string, present: boolean) {
    setBusy(userId);
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("crew_event_check_in", {
      p_event: eventId,
      p_user: userId,
      p_present: present,
    });
    setBusy(null);
    if (error) setErr(duesErrText(t, error.message));
    else router.refresh();
  }

  /** 참석자 전원 출석 — 정기 모임에서 한 명씩 누르는 게 대부분 낭비다.
   *  이미 체크된 사람은 건너뛰고, 한 건이라도 실패하면 거기서 멈추고 알린다. */
  async function checkAllGoing() {
    const targets = rows.filter(
      (r) =>
        !r.checked_in &&
        (r.rsvp_status === "going" || r.rsvp_status === "waitlisted"),
    );
    if (!targets.length) return;
    if (!window.confirm(t("crew.checkAllConfirm", { n: targets.length }))) return;
    setBusy("all");
    setErr(null);
    const supabase = createClient();
    for (const r of targets) {
      const { error } = await supabase.rpc("crew_event_check_in", {
        p_event: eventId,
        p_user: r.user_id,
        p_present: true,
      });
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
    const { error } = await createClient().rpc(
      confirmed ? "unconfirm_dues_charge" : "confirm_dues_charge",
      { p_charge: chargeId },
    );
    setBusy(null);
    if (error) setErr(duesErrText(t, error.message));
    else router.refresh();
  }

  const present = rows.filter((r) => r.checked_in);
  // 불참 = 참석하겠다고 해 놓고 출석 체크가 안 된 사람. 모임이 시작하기
  // 전에는 아직 안 온 것일 뿐이라 불참으로 세지 않는다.
  const noShow = rows.filter(
    (r) =>
      !r.checked_in &&
      (r.rsvp_status === "going" || r.rsvp_status === "waitlisted"),
  );

  // 출석 탭 기본은 참석 신청자 + 이미 체크된 사람. 나머지 크루원은 접어 둔다 —
  // 워크인 체크가 필요할 때만 펼치면 된다.
  const rsvpd = rows.filter(
    (r) =>
      r.checked_in ||
      r.rsvp_status === "going" ||
      r.rsvp_status === "waitlisted",
  );
  const rest = rows.filter((r) => !rsvpd.includes(r));
  const shown = showAll ? [...rsvpd, ...rest] : rsvpd;

  // 이 모임의 회차비 현황 — 현장에서 얼마 받았고 얼마 남았는지
  const due = rows.filter(
    (r) =>
      r.charge_id &&
      (r.charge_status === "pending" || r.charge_status === "reported"),
  );
  const paidSum = rows
    .filter((r) => r.charge_status === "confirmed")
    .reduce((a, r) => a + (r.charge_amount ?? 0), 0);
  const dueSum = due.reduce((a, r) => a + (r.charge_amount ?? 0), 0);

  const rsvpLabel = (status: string | null) => {
    if (status === "going") return [t("crew.rsvpGoing"), "text-success"];
    if (status === "waitlisted") return [t("crew.rsvpWaitlisted"), "text-accent"];
    if (status === "maybe") return [t("crew.rsvpMaybe"), "text-accent-dim"];
    if (status === "declined") return [t("crew.rsvpDeclined"), "text-danger"];
    return [t("crew.rsvpNone"), "text-muted"];
  };

  const tabBtn = (key: "attend" | "going", label: string, count: number) => {
    const on = tab === key;
    return (
      <button
        key={key}
        type="button"
        onClick={() => setTab(key)}
        className={`flex h-[30px] items-center gap-1.5 rounded-full px-3 text-[13px] font-bold transition-colors ${
          on ? "bg-accent text-background" : "text-muted hover:text-foreground"
        }`}
      >
        {label}
        <span
          className={`tabular rounded-full px-1.5 text-[11px] font-bold ${
            on ? "bg-[#6b5a00] text-accent" : "bg-line text-muted"
          }`}
        >
          {count}
        </span>
      </button>
    );
  };

  const rowCls =
    "grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line-soft px-[22px] py-3 transition-colors hover:bg-card-hover max-md:px-4";

  return (
    <div className="overflow-hidden rounded-[14px] border border-line bg-card">
      {/* 헤더 — 탭 + 운영진 설정 */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-[22px] py-3 max-md:px-4">
        <div className="flex items-center gap-1 rounded-full border border-line-mid bg-page p-[3px]">
          {/* 크루원도 두 탭을 다 본다 — 출석 탭이 읽기 전용일 뿐이다 */}
          {tabBtn("attend", t("crew.attendCheckTab"), present.length)}
          {tabBtn("going", t("crew.goingList"), going.length)}
        </div>

        {(settings || tab === "attend") && (
          <div className="ml-auto flex flex-wrap items-center gap-3 max-md:ml-0 max-md:w-full max-md:justify-end">
            {settings && (
              <span className="flex items-center gap-2.5">
                <span className="text-xs text-muted">
                  {t("crew.eventSettings")}
                </span>
                {settings}
              </span>
            )}
            {canEdit && tab === "attend" && noShow.length > 0 && (
              <button
                type="button"
                onClick={checkAllGoing}
                disabled={busy != null}
                className="flex h-8 items-center rounded-lg border border-line-accent bg-highlight px-3 text-[13px] font-bold text-accent transition hover:brightness-125 disabled:opacity-40"
              >
                {t("crew.checkAllGoing")}
              </button>
            )}
            {tab === "attend" && present.length > 0 && (
              <CrewEventInstaCopy eventId={eventId} />
            )}
          </div>
        )}
      </div>

      {/* 힌트 행 */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line-soft px-[22px] py-2.5 text-[13px] text-muted max-md:px-4">
        <span className="[word-break:keep-all]">
          {feeExempt
            ? t("crew.feeExemptNote")
            : tab === "going"
              ? t("crew.goingListNote")
              : t("crew.attendTabNote")}
        </span>
        {canEdit && (
          <span className="tabular shrink-0">
            {t("crew.attendCounted", {
              n: present.length,
              total: memberCount || rows.length,
            })}
            {started && noShow.length > 0 && (
              <span className="ml-2 text-danger">
                {t("crew.attendNoShow", { n: noShow.length })}
              </span>
            )}
          </span>
        )}
      </div>

      {/* 회차비 수납 요약 — 운영진만, 청구가 있을 때만 */}
      {canEdit && (paidSum > 0 || dueSum > 0) && (
        <p className="border-b border-line-soft px-[22px] py-2 text-xs max-md:px-4">
          <span className="text-muted">{t("crew.attendFeeTitle")} </span>
          <span className="tabular font-bold text-info">{won(paidSum)}</span>
          <span className="text-muted"> · </span>
          <span className="tabular font-bold text-accent">{won(dueSum)}</span>
          <span className="text-muted"> {t("crew.attendFeeDue")}</span>
        </p>
      )}

      {err && (
        <p className="border-b border-line-soft px-[22px] py-2 text-xs text-danger max-md:px-4">
          {err}
        </p>
      )}

      {/* 출석 체크 탭 — 운영진은 토글, 크루원은 읽기 전용 */}
      {tab === "attend" ? (
        <>
          <ul className="grid sm:grid-cols-2">
            {shown.map((r) => {
              const [label, cls] = rsvpLabel(r.rsvp_status);
              const dim =
                !r.checked_in &&
                r.rsvp_status !== "going" &&
                r.rsvp_status !== "waitlisted";
              return (
                <li
                  key={r.user_id}
                  className={`${rowCls} ${dim ? "opacity-60" : ""}`}
                >
                  <Avatar name={r.display_name} size={36} />
                  <span className="min-w-0">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[15px] font-bold">
                        {r.display_name}
                      </span>
                      {isStaffRole(r.role) && (
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-extrabold ${crewRoleBadgeClass(r.role)}`}
                        >
                          {t(crewRoleDictKey(r.role))}
                        </span>
                      )}
                    </span>
                    <span className={`mt-0.5 block text-xs ${cls}`}>
                      {label}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {/* 회차비 — 청구가 있을 때만. 무료 행사·회차비 없는 등급은 안 뜬다 */}
                    {canEdit &&
                      r.charge_id &&
                      r.charge_amount != null &&
                      (r.charge_status === "waived" ? (
                        <span className="rounded-md bg-label-bg px-2 py-1 text-[11px] font-bold text-label">
                          {t("crew.duesWaived")}
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={busy != null}
                          onClick={() =>
                            settle(r.charge_id!, r.charge_status === "confirmed")
                          }
                          className={`tabular rounded-md px-2 py-1 text-[11px] font-bold disabled:opacity-50 ${
                            r.charge_status === "confirmed"
                              ? "bg-info-bg text-info"
                              : "bg-page text-accent ring-1 ring-line-accent"
                          }`}
                        >
                          {r.charge_status === "confirmed" ? "✓ " : ""}
                          {won(r.charge_amount)}
                        </button>
                      ))}
                    <button
                      type="button"
                      disabled={!canEdit || busy != null}
                      onClick={() => toggle(r.user_id, !r.checked_in)}
                      className={`flex h-8 items-center rounded-lg px-2.5 text-[13px] font-bold transition-colors disabled:opacity-100 ${
                        r.checked_in
                          ? "bg-accent text-background"
                          : "border border-line-strong text-muted"
                      } ${canEdit ? "disabled:opacity-50" : "cursor-default"}`}
                    >
                      {r.checked_in
                        ? `✓ ${t("crew.attendPresent")}`
                        : t("crew.attendMark")}
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
          {!shown.length && (
            <p className="px-[22px] py-8 text-center text-[13px] text-muted max-md:px-4">
              {t("crew.attendNoRsvp")}
            </p>
          )}
          {canEdit && rest.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="w-full px-[22px] py-3 text-[13px] font-bold text-accent hover:underline max-md:px-4"
            >
              {showAll
                ? t("crew.attendHideOthers")
                : t("crew.attendShowOthers", { n: rest.length })}
            </button>
          )}
        </>
      ) : (
        /* 참석 명단 탭 — 등급 배지 (크루원에게만 채워져 온다) */
        <>
          <ul className="grid sm:grid-cols-2">
            {going.map((g, i) => (
              <li key={i} className={rowCls}>
                <Avatar name={g.name} size={36} />
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[15px] font-bold">
                      {g.name}
                    </span>
                    {g.tier && (
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-extrabold ${tierBadgeClass(g.color)}`}
                      >
                        {g.tier}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-success">
                    {t("crew.rsvpGoing")}
                  </span>
                </span>
                <span />
              </li>
            ))}
          </ul>
          {!going.length && (
            <p className="px-[22px] py-8 text-center text-[13px] text-muted max-md:px-4">
              —
            </p>
          )}
          {waitlistNames.length > 0 && (
            <p className="px-[22px] py-3 text-[13px] text-accent max-md:px-4">
              ⏳ {t("crew.waitlistTitle")} ({waitlistNames.length}):{" "}
              {waitlistNames.join(", ")}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** 모임 설정 토글 — 운영진 전용.
 *  · 무료 행사: 켜면 그 모임의 미납 회차비를 즉시 회수하고, 끄면 그 달을 다시
 *    대사해 출석분 청구를 되살린다 (확정분은 그대로).
 *  · 정회원 전용: 켜면 정회원 권한이 없는 등급에게 모임이 아예 안 보인다.
 *    이미 신청·출석한 기록은 지우지 않는다 — 실제로 있었던 일이고, 지우면
 *    출석 통계와 회차비 청구의 근거가 사라진다. */
export function CrewEventFeeToggle({
  eventId,
  feeExempt,
  membersOnly,
}: {
  eventId: string;
  feeExempt: boolean;
  membersOnly: boolean;
}) {
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
    const { error } = await createClient().rpc("set_event_fee_exempt", {
      p_event: eventId,
      p_on: on,
    });
    setBusy(null);
    if (error) setErr(duesErrText(t, error.message));
    else router.refresh();
  }

  async function toggleMembers(on: boolean) {
    if (on && !window.confirm(t("crew.fullOnlyConfirm"))) return;
    setBusy("members");
    setErr(null);
    setNote(null);
    const { data, error } = await createClient().rpc("set_event_members_only", {
      p_event: eventId,
      p_on: on,
    });
    setBusy(null);
    if (error) return setErr(duesErrText(t, error.message));
    const hidden = (data as { hidden_from?: number } | null)?.hidden_from ?? 0;
    if (on && hidden > 0) setNote(t("crew.fullOnlyHidden", { n: hidden }));
    router.refresh();
  }

  return (
    <span className="flex flex-wrap items-center gap-3">
      <label className="flex cursor-pointer items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={membersOnly}
          disabled={busy != null}
          onChange={(e) => toggleMembers(e.target.checked)}
          className="h-4 w-4 accent-accent"
        />
        <span>{t("crew.fullOnly")}</span>
      </label>
      <label className="flex cursor-pointer items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={feeExempt}
          disabled={busy != null}
          onChange={(e) => toggleFee(e.target.checked)}
          className="h-4 w-4 accent-accent"
        />
        <span>{t("crew.feeExempt")}</span>
      </label>
      {note && <span className="text-xs text-muted">{note}</span>}
      {err && <span className="text-xs text-red-400">{err}</span>}
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
    <button
      type="button"
      onClick={share}
      className="flex h-[34px] shrink-0 items-center rounded-lg border border-line-strong bg-control px-3.5 text-[13px] font-semibold transition-colors hover:border-[#555]"
    >
      {done ? t("crew.shareCopied") : t("crew.shareLink")}
    </button>
  );
}


/** 모임 종료 — 운영진 전용. 종료하면 크루원은 참석 여부를 더 바꿀 수 없다
 *  (DB RLS 가 막는다). 취소와 달리 모임은 그대로 보이고, 운영진은 종료 뒤에도
 *  출석을 고칠 수 있다 — 종료 시점의 오타를 되돌릴 방법이 있어야 한다. */
export function CrewEventClose({
  eventId,
  closed,
}: {
  eventId: string;
  closed: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    if (!closed && !window.confirm(t("crew.closeConfirm"))) return;
    setBusy(true);
    setErr(null);
    const { error } = await createClient().rpc("set_event_closed", {
      p_event: eventId,
      p_on: !closed,
    });
    setBusy(false);
    if (error) setErr(duesErrText(t, error.message));
    else router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className="w-full rounded-lg px-3 py-2 text-left text-[13px] transition-colors hover:bg-card-hover disabled:opacity-50"
      >
        {closed ? t("crew.reopen") : t("crew.close")}
      </button>
      {err && <span className="px-3 text-[11px] text-danger">{err}</span>}
    </>
  );
}

/**
 * 일정 목록용 한 버튼 참석 토글 (디자인 핸드오프).
 * 상세의 CrewRsvpButtons(참석/미정/불참 3지선다)와 달리 목록에서는 참석 여부만
 * 빠르게 바꾼다. 참석을 끄면 응답 자체를 지운다 — 목록에서 끈 것을 "불참 선언"
 * 으로 기록하면 불참 명단이 사실과 달라진다.
 * 종료된 모임은 비활성 (최종 차단은 DB RLS).
 */
export function CrewRsvpToggle({
  eventId,
  myStatus,
  closed = false,
}: {
  eventId: string;
  myStatus: string | null;
  closed?: boolean;
}) {
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
        ? await supabase
            .from("crew_event_rsvps")
            .delete()
            .eq("event_id", eventId)
            .eq("user_id", u.user.id)
        : await supabase.from("crew_event_rsvps").upsert(
            { event_id: eventId, user_id: u.user.id, status: "going" },
            { onConflict: "event_id,user_id" },
          );
    setBusy(false);
    if (error) setErr(error.message);
    else router.refresh();
  }

  if (closed) {
    return (
      <span className="inline-flex h-[34px] shrink-0 items-center rounded-lg border border-line-strong px-3 text-xs font-semibold text-muted">
        {going ? t("crew.rsvpDone") : t("crew.rsvpMissed")}
      </span>
    );
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className={`inline-flex h-[34px] shrink-0 items-center rounded-lg px-3.5 text-xs font-bold transition-colors disabled:opacity-50 ${
          going || waitlisted
            ? "border border-line-accent bg-highlight text-accent"
            : "bg-accent text-background hover:brightness-110"
        }`}
      >
        {waitlisted
          ? `⏳ ${t("crew.rsvpWaitlisted")}`
          : going
            ? `✓ ${t("crew.rsvpGoing")}`
            : t("crew.rsvpJoin")}
      </button>
      {err && <span className="text-[10px] text-danger">{err}</span>}
    </span>
  );
}
