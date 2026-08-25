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

export type MyRacePlan = { id: string; title: string; race_date: string; note: string | null };

/** 대회 참가 일정 — 멤버 본인이 등록·삭제. 크루 일정표에 표기된다. */
export function CrewRacePlanForm({ myPlans }: { myPlans: MyRacePlan[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !date) return;
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
      note: note.trim() || null,
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setTitle("");
    setDate("");
    setNote("");
    setOpen(false);
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
          onClick={() => setOpen(true)}
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
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("crew.racePlanTitlePh")}
            maxLength={80}
          />
          <input
            type="date"
            className={input}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
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
          {myPlans.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-xs text-muted">
              <span className="font-mono">{p.race_date}</span>
              <span className="truncate text-foreground">{p.title}</span>
              <button
                type="button"
                onClick={() => del(p.id)}
                className="text-muted hover:text-red-400"
                aria-label={t("common.delete")}
              >
                ✕
              </button>
            </li>
          ))}
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
