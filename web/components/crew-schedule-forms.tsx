"use client";

import { useRouter } from "next/navigation";
import { DIVISIONS } from "@/lib/divisions";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { dictLabel } from "@/lib/dict-label";
import { duesErrText } from "@/lib/dues-error";

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
}: {
  crewId?: string;
  event?: MeetupEditable;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const editing = !!event;
  const [open, setOpen] = useState(false);
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
};

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
export function RacePlanForm({ myPlans }: { myPlans: MyRacePlan[] }) {
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

  return (
    <div className="flex flex-col gap-2">
      {!open ? (
        <button
          type="button"
          onClick={openForm}
          className="self-start rounded-md bg-surface px-3 py-1.5 text-xs font-semibold text-track hover:brightness-110"
        >
          + {t("crew.racePlanAdd")}
        </button>
      ) : (
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
      )}
      {myPlans.length > 0 && (
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
              <li key={p.id} className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="font-mono">{p.race_date}</span>
                <span className="truncate text-foreground">{p.title}</span>
                {p.division && (
                  <span className="min-w-0 truncate">
                    {dictLabel(t, `division.${p.division}`, p.division)}
                  </span>
                )}
                {p.bib && (
                  <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 font-mono text-[10px] font-bold text-track">
                    BIB {p.bib}
                  </span>
                )}
                {!p.goal_plan_id && (
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
                  className="text-muted hover:text-accent"
                >
                  {t("common.edit")}
                </button>
                <button
                  type="button"
                  onClick={() => del(p.id)}
                  className="text-muted hover:text-red-400"
                  aria-label={t("common.delete")}
                >
                  ✕
                </button>
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

  return (
    <div>
      <div className="flex gap-2">
        {opts.map(([v, label]) => (
          <button
            key={v}
            type="button"
            disabled={busy || closed}
            onClick={() => set(v)}
            className={`rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50 ${
              myStatus === v || (v === "going" && waitlisted)
                ? v === "declined"
                  ? "bg-red-400/20 text-red-400"
                  : waitlisted && v === "going"
                    ? "bg-accent/25 text-accent ring-1 ring-accent/50"
                    : "bg-accent text-background"
                : "bg-surface text-muted hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {waitlisted && (
        <p className="mt-2 text-xs text-accent">{t("crew.waitlistNote")}</p>
      )}
      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
    </div>
  );
}

/** 모임 댓글 입력 — 크루원 전용, 댓글 허용 모임에만 렌더된다.
 *  권한(멤버·comments_allowed·members_only)은 RLS 가 최종 강제. */
export function CrewEventCommentForm({ eventId }: { eventId: string }) {
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
      <form onSubmit={submit} className="mt-4 flex gap-2">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("crew.commentPlaceholder")}
          maxLength={500}
          className="flex-1 rounded-md border border-muted/30 bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={busy || !body.trim()}
          className="shrink-0 rounded-md border border-accent/50 px-4 text-sm font-semibold text-accent hover:bg-accent/10 disabled:opacity-50"
        >
          {t("crew.commentSubmit")}
        </button>
      </form>
      {err && <p className="mt-1 text-xs text-red-400">{err}</p>}
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
    <span className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={cancel}
        disabled={busy}
        className="text-xs text-muted hover:text-red-400 disabled:opacity-50"
      >
        {t("crew.meetupCancel")}
      </button>
      {err && <span className="text-xs text-red-400">{err}</span>}
    </span>
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

export function CrewAttendanceCheck({
  eventId,
  rows,
  canEdit,
  started,
}: {
  eventId: string;
  rows: AttendanceRow[];
  canEdit: boolean;
  /** 모임이 이미 시작했는지. 시작 전에는 "아직 안 옴"이지 불참이 아니다.
   *  렌더 중에 Date.now() 를 부르면 순수하지 않으므로 서버에서 판정해 받는다. */
  started: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

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

  // 읽기 전용(일반 크루원)이면 출석한 사람만 보여준다.
  if (!canEdit) {
    return (
      <div>
        <p className="text-sm">
          <b>{present.length}</b>
          <span className="ml-1 text-muted">{t("crew.attendUnit")}</span>
          {started && noShow.length > 0 && (
            <span className="ml-2 text-xs text-muted">
              {t("crew.attendNoShow", { n: noShow.length })}
            </span>
          )}
        </p>
        {present.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {present.map((r) => (
              <li
                key={r.user_id}
                className="rounded-full bg-accent/15 px-3 py-1 text-xs font-medium text-accent"
              >
                ✓ {r.display_name}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // 운영진: 참석 신청자(going/waitlisted)를 먼저 보여주고, 나머지 크루원은
  // 접어 둔다 — 워크인 체크가 필요할 때만 펼치면 된다.
  const rsvpd = rows.filter(
    (r) => r.checked_in || r.rsvp_status === "going" || r.rsvp_status === "waitlisted",
  );
  const rest = rows.filter((r) => !rsvpd.includes(r));
  const shown = showAll ? [...rsvpd, ...rest] : rsvpd;

  // 이 모임의 회차비 현황 — 현장에서 얼마 받았고 얼마 남았는지
  const due = rows.filter(
    (r) => r.charge_id && (r.charge_status === "pending" || r.charge_status === "reported"),
  );
  const paidSum = rows
    .filter((r) => r.charge_status === "confirmed")
    .reduce((a, r) => a + (r.charge_amount ?? 0), 0);
  const dueSum = due.reduce((a, r) => a + (r.charge_amount ?? 0), 0);

  return (
    <div>
      <p className="text-xs text-muted">
        {t("crew.attendCounted", { n: present.length, total: rows.length })}
        {started && noShow.length > 0 && (
          <span className="ml-2 text-red-400">
            {t("crew.attendNoShow", { n: noShow.length })}
          </span>
        )}
      </p>
      {(paidSum > 0 || dueSum > 0) && (
        <p className="mt-1 text-xs">
          <span className="text-muted">{t("crew.attendFeeTitle")} </span>
          <span className="font-mono font-bold text-track">{won(paidSum)}</span>
          <span className="text-muted"> · </span>
          <span className="font-mono font-bold text-accent">{won(dueSum)}</span>
          <span className="text-muted"> {t("crew.attendFeeDue")}</span>
        </p>
      )}
      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
      <ul className="mt-2 flex flex-col gap-1.5">
        {shown.map((r) => (
          <li
            key={r.user_id}
            className="flex items-center justify-between gap-3 rounded-md bg-surface px-4 py-2.5"
          >
            <span className="flex min-w-0 flex-col">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm">{r.display_name}</span>
                {r.rsvp_status === "going" && (
                  <span className="shrink-0 text-[10px] text-muted">
                    {t("crew.rsvpGoing")}
                  </span>
                )}
                {r.rsvp_status === "waitlisted" && (
                  <span className="shrink-0 text-[10px] text-muted">
                    ⏳ {t("crew.rsvpWaitlisted")}
                  </span>
                )}
                {started && !r.checked_in &&
                  (r.rsvp_status === "going" ||
                    r.rsvp_status === "waitlisted") && (
                    <span className="shrink-0 rounded-full bg-red-400/15 px-2 py-0.5 text-[10px] font-bold text-red-400">
                      {t("crew.attendAbsent")}
                    </span>
                  )}
              </span>
              {r.email && (
                <span className="truncate text-[11px] text-muted">{r.email}</span>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {/* 회차비 — 청구가 있을 때만. 무료 행사·회차비 없는 등급은 안 뜬다 */}
              {r.charge_id && r.charge_amount != null && (
                r.charge_status === "waived" ? (
                  <span className="rounded-full bg-track/15 px-2.5 py-1 text-[11px] font-bold text-track">
                    {t("crew.duesWaived")}
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={busy != null}
                    onClick={() =>
                      settle(r.charge_id!, r.charge_status === "confirmed")
                    }
                    className={`rounded-full px-2.5 py-1 font-mono text-[11px] font-bold disabled:opacity-50 ${
                      r.charge_status === "confirmed"
                        ? "bg-track/15 text-track"
                        : "bg-background text-accent ring-1 ring-accent/40"
                    }`}
                  >
                    {r.charge_status === "confirmed" ? "✓ " : ""}
                    {won(r.charge_amount)}
                  </button>
                )
              )}
              <button
                type="button"
                disabled={busy != null}
                onClick={() => toggle(r.user_id, !r.checked_in)}
                className={`rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-50 ${
                  r.checked_in
                    ? "bg-accent text-background"
                    : "bg-background text-muted hover:text-foreground"
                }`}
              >
                {r.checked_in ? `✓ ${t("crew.attendPresent")}` : t("crew.attendMark")}
              </button>
            </span>
          </li>
        ))}
      </ul>
      {!shown.length && (
        <p className="mt-2 rounded-md bg-surface px-4 py-6 text-center text-xs text-muted">
          {t("crew.attendNoRsvp")}
        </p>
      )}
      {rest.length > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-2 text-xs text-accent hover:underline"
        >
          {showAll
            ? t("crew.attendHideOthers")
            : t("crew.attendShowOthers", { n: rest.length })}
        </button>
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
      className="shrink-0 rounded-md bg-surface px-3 py-1.5 text-xs font-semibold hover:text-accent"
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
    <span className="flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className={`rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
          closed
            ? "bg-surface text-muted hover:text-foreground"
            : "bg-surface hover:text-accent"
        }`}
      >
        {closed ? t("crew.reopen") : t("crew.close")}
      </button>
      {err && <span className="text-xs text-red-400">{err}</span>}
    </span>
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
