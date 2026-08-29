"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

const input =
  "rounded-md border border-muted/30 bg-background px-3 py-2 text-sm outline-none focus:border-accent";

/** 모임 등록 — 스태프 전용. crew_events RLS(is_crew_staff)가 권한을 강제한다. */
export function CrewMeetupForm({ crewId }: { crewId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [location, setLocation] = useState("");
  const [desc, setDesc] = useState("");
  const [membersOnly, setMembersOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !when) return;
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("crew_events").insert({
      crew_id: crewId,
      title: title.trim(),
      kind: "social",
      starts_at: new Date(when).toISOString(),
      location: location.trim() || null,
      description: desc.trim() || null,
      members_only: membersOnly,
      created_by: u.user?.id ?? null,
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setTitle("");
    setWhen("");
    setLocation("");
    setDesc("");
    setMembersOnly(false);
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
        + {t("crew.meetupAdd")}
      </button>
    );
  }
  return (
    <form onSubmit={save} className="flex w-full flex-col gap-2 rounded-md bg-surface p-4">
      <p className="text-sm font-semibold">{t("crew.meetupAdd")}</p>
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
      {err && <p className="text-xs text-red-400">{err}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy || !title.trim() || !when}
          className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-background disabled:opacity-40"
        >
          {t("crew.meetupCreate")}
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
  start_date: string | null;
};

/** 대회 참가 일정 — 멤버 본인이 등록·삭제. 크루 일정표에 표기된다.
 *  공식 대회(race_events)를 검색해 선택하면 이름·날짜가 채워지고 대회에 연결된다.
 *  목록에 없는 대회는 직접 입력도 가능. */
export function CrewRacePlanForm({ myPlans }: { myPlans: MyRacePlan[] }) {
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
      .select("id, name, city, start_date")
      .gte("start_date", new Date().toISOString().slice(0, 10))
      .order("start_date", { ascending: true })
      .limit(100);
    setEvents((data ?? []) as RaceEventRow[]);
  }

  // 검색어와 매칭되는 공식 대회 (이름·도시, 최대 6개). 이미 선택했으면 숨김
  const term = title.trim().toLowerCase();
  const matches =
    !eventId && term.length >= 1 && events
      ? events
          .filter((e) =>
            [e.name, e.city].some((v) => v.toLowerCase().includes(term)),
          )
          .slice(0, 6)
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
    await supabase.from("race_plans").delete().eq("id", id);
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
          <input
            className={input}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setEventId(null); // 직접 수정하면 공식 대회 연결 해제
            }}
            placeholder={t("crew.racePlanTitlePh")}
            maxLength={80}
          />
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
          {eventId && (
            <p className="text-xs text-track">✓ {t("crew.racePlanLinked")}</p>
          )}
          <input
            type="date"
            className={input}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <div className="flex gap-2">
            <input
              className={input}
              value={division}
              onChange={(e) => setDivision(e.target.value)}
              placeholder={t("crew.racePlanDivisionPh")}
              maxLength={40}
            />
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
                    <input
                      className={input}
                      value={eDivision}
                      onChange={(e) => setEDivision(e.target.value)}
                      placeholder={t("crew.racePlanDivisionPh")}
                      maxLength={40}
                    />
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
              <li key={p.id} className="flex items-center gap-2 text-xs text-muted">
                <span className="font-mono">{p.race_date}</span>
                <span className="truncate text-foreground">{p.title}</span>
                {p.division && <span className="shrink-0">{p.division}</span>}
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
}: {
  eventId: string;
  myStatus: string | null;
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

  const opts = [
    ["going", t("crew.rsvpGoing")],
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
            disabled={busy}
            onClick={() => set(v)}
            className={`rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50 ${
              myStatus === v
                ? v === "declined"
                  ? "bg-red-400/20 text-red-400"
                  : "bg-accent text-background"
                : "bg-surface text-muted hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
    </div>
  );
}

/** 모임 취소 — 스태프 전용 soft cancel. */
export function CrewMeetupCancel({ eventId, slug }: { eventId: string; slug: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function cancel() {
    if (!window.confirm(t("crew.meetupCancelConfirm"))) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("crew_events")
      .update({ cancelled_at: new Date().toISOString() })
      .eq("id", eventId);
    setBusy(false);
    if (!error) {
      router.push(`/crews/${slug}/schedule`);
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={cancel}
      disabled={busy}
      className="text-xs text-muted hover:text-red-400 disabled:opacity-50"
    >
      {t("crew.meetupCancel")}
    </button>
  );
}
