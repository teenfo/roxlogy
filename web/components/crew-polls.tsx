"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/crew-ui";
import type { DictKey } from "@/lib/i18n/dictionaries/en";

/** crew_poll_* RPC 응답 한 건 (마이그레이션 115) */
export type CrewPoll = {
  id: string;
  question: string;
  multiple: boolean;
  anonymous: boolean;
  closes_at: string | null;
  closed_at: string | null;
  closed: boolean;
  created_by: string | null;
  created_by_name: string;
  created_at: string;
  can_manage: boolean;
  can_vote: boolean;
  voters: number;
  my_votes: string[];
  options: { id: string; label: string; votes: number; names: string[] }[];
};

const MAX_OPTIONS = 10;
const input =
  "h-10 w-full min-w-0 rounded-lg border border-line-strong bg-page px-3 text-sm outline-none focus:border-accent";

/**
 * 크루 투표 — 모임 상세와 게시글 상세가 같이 쓴다. 투표는 모임 또는 게시글 하나에 붙는다.
 *
 * 권한은 서버(RPC)가 정한다: 만들기(모임 = 운영진, 게시글 = 글쓴이·운영진), 투표(크루원),
 * 마감·삭제(만든 사람·운영진). 화면은 can_* 값으로 버튼만 숨긴다.
 * 결과는 투표 전에도 보인다. 익명 투표면 서버가 이름을 내려주지 않는다.
 */
export function CrewPolls({
  eventId,
  postId,
  initial,
  canCreate,
}: {
  eventId?: string;
  postId?: string;
  initial: CrewPoll[];
  /** 이 대상에 투표를 만들 수 있는가 — 모임: 운영진, 게시글: 글쓴이·운영진 */
  canCreate: boolean;
}) {
  const { t } = useI18n();
  const [polls, setPolls] = useState<CrewPoll[]>(initial);
  const [open, setOpen] = useState(false);

  const replace = (p: CrewPoll) => setPolls((ps) => ps.map((x) => (x.id === p.id ? p : x)));

  if (!polls.length && !canCreate) return null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h3 className="text-[15px] font-extrabold">
          {t("crew.poll.title")}
          {polls.length > 0 && <span className="ml-1.5 text-[13px] font-normal text-muted">{polls.length}</span>}
        </h3>
        {canCreate && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="ml-auto flex h-8 items-center rounded-lg border border-line-strong bg-control px-3 text-[13px] font-semibold hover:border-muted/60"
          >
            + {t("crew.poll.create")}
          </button>
        )}
      </div>

      {polls.map((p) => (
        <PollCard
          key={p.id}
          poll={p}
          onChange={replace}
          onDelete={() => setPolls((ps) => ps.filter((x) => x.id !== p.id))}
        />
      ))}

      {canCreate && (
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          label={t("crew.poll.create")}
          closeLabel={t("common.cancel")}
          panelClassName="max-w-lg"
        >
          {open && (
            <PollCreateForm
              eventId={eventId}
              postId={postId}
              onDone={(p) => {
                setPolls((ps) => [...ps, p]);
                setOpen(false);
              }}
              onCancel={() => setOpen(false)}
            />
          )}
        </Dialog>
      )}
    </section>
  );
}

function errText(t: (k: DictKey) => string, code: string | undefined) {
  const key = `crew.poll.err.${code ?? "unknown"}` as DictKey;
  const v = t(key);
  return v === key ? t("crew.poll.err.unknown") : v;
}

function PollCard({ poll, onChange, onDelete }: { poll: CrewPoll; onChange: (p: CrewPoll) => void; onDelete: () => void }) {
  const { t, tag } = useI18n();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 복수 선택은 고른 뒤 한 번에 보낸다. 단일 선택은 누르면 바로 보낸다.
  const [picked, setPicked] = useState<string[]>(poll.my_votes);
  const [showNames, setShowNames] = useState(false);

  const voted = poll.my_votes.length > 0;
  const interactive = poll.can_vote && !poll.closed;
  const dirty =
    poll.multiple && (picked.length !== poll.my_votes.length || picked.some((id) => !poll.my_votes.includes(id)));

  async function call(fn: string, args: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    const { data, error } = await createClient().rpc(fn, args);
    setBusy(false);
    if (error) {
      setErr(error.message);
      return null;
    }
    const j = data as (CrewPoll & { error?: string }) | { ok?: boolean; error?: string } | null;
    if (j && "error" in j && j.error) {
      setErr(errText(t, j.error));
      return null;
    }
    return j;
  }

  async function vote(ids: string[]) {
    const j = (await call("crew_poll_vote", { p_poll: poll.id, p_options: ids })) as CrewPoll | null;
    if (j) {
      onChange(j);
      setPicked(j.my_votes);
    }
  }

  function clickOption(id: string) {
    if (!interactive || busy) return;
    if (!poll.multiple) {
      // 같은 걸 다시 누르면 취소
      void vote(poll.my_votes.includes(id) ? [] : [id]);
      return;
    }
    setPicked((ps) => (ps.includes(id) ? ps.filter((x) => x !== id) : [...ps, id]));
  }

  async function setClosed(closed: boolean) {
    const j = (await call("crew_poll_set_closed", { p_poll: poll.id, p_closed: closed })) as CrewPoll | null;
    if (j) onChange(j);
  }

  async function remove() {
    if (!window.confirm(t("crew.poll.deleteConfirm"))) return;
    const j = await call("crew_poll_delete", { p_poll: poll.id });
    if (j) onDelete();
  }

  const deadline = poll.closes_at
    ? new Date(poll.closes_at).toLocaleString(tag, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;
  const max = Math.max(0, ...poll.options.map((o) => o.votes));

  return (
    <div className="rounded-2xl border border-line bg-card px-[18px] py-4 max-md:px-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {poll.closed ? (
          <Badge tone="neutral">{t("crew.poll.closed")}</Badge>
        ) : (
          <Badge tone="success">{t("crew.poll.open")}</Badge>
        )}
        <Badge tone="neutral">{t(poll.multiple ? "crew.poll.multiple" : "crew.poll.single")}</Badge>
        {poll.anonymous && <Badge tone="label">{t("crew.poll.anonymous")}</Badge>}
        {deadline && !poll.closed && (
          <span className="text-xs text-muted">{t("crew.poll.until", { at: deadline })}</span>
        )}
      </div>
      <p className="mt-2 text-[16px] font-bold leading-snug [overflow-wrap:anywhere]">{poll.question}</p>
      <p className="mt-0.5 text-xs text-muted">
        {poll.created_by_name} · {t("crew.poll.voters", { n: poll.voters })}
      </p>

      <ul className="mt-3 flex flex-col gap-2" role={poll.multiple ? "group" : "radiogroup"} aria-label={poll.question}>
        {poll.options.map((o) => {
          const share = poll.voters > 0 ? Math.round((o.votes / poll.voters) * 100) : 0;
          const mine = poll.my_votes.includes(o.id);
          const sel = poll.multiple ? picked.includes(o.id) : mine;
          const lead = o.votes > 0 && o.votes === max;
          return (
            <li key={o.id}>
              <button
                type="button"
                role={poll.multiple ? "checkbox" : "radio"}
                aria-checked={sel}
                disabled={!interactive || busy}
                onClick={() => clickOption(o.id)}
                className={`relative flex w-full items-center gap-2.5 overflow-hidden rounded-xl border px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-default ${
                  sel ? "border-accent" : "border-line-strong"
                } ${interactive ? "hover:border-muted/60" : ""}`}
              >
                {/* 결과 막대 — 투표자 대비 비율(복수 선택이면 합이 100 을 넘을 수 있다) */}
                <span
                  aria-hidden
                  className={`absolute inset-y-0 left-0 ${lead ? "bg-accent/15" : "bg-line/60"}`}
                  style={{ width: `${share}%` }}
                />
                <span
                  aria-hidden
                  className={`relative flex h-4 w-4 shrink-0 items-center justify-center border ${
                    poll.multiple ? "rounded" : "rounded-full"
                  } ${sel ? "border-accent bg-accent text-background" : "border-muted/70"}`}
                >
                  {sel && <span className="text-[10px] font-black leading-none">✓</span>}
                </span>
                <span className="relative min-w-0 flex-1 font-semibold [overflow-wrap:anywhere]">{o.label}</span>
                <span className="tabular relative shrink-0 text-xs text-muted">
                  {o.votes} · {share}%
                </span>
              </button>
              {showNames && !poll.anonymous && o.names.length > 0 && (
                <p className="mt-1 px-1 text-xs text-muted [overflow-wrap:anywhere]">{o.names.join(", ")}</p>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {interactive && poll.multiple && (
          <button
            type="button"
            onClick={() => vote(picked)}
            disabled={busy || !dirty}
            className="flex h-9 items-center rounded-lg bg-accent px-4 text-[13px] font-extrabold text-background hover:brightness-110 disabled:opacity-40"
          >
            {voted ? t("crew.poll.update") : t("crew.poll.submit")}
          </button>
        )}
        {interactive && voted && (
          <button
            type="button"
            onClick={() => vote([])}
            disabled={busy}
            className="flex h-9 items-center rounded-lg border border-line-strong px-3 text-[13px] font-semibold text-muted disabled:opacity-40"
          >
            {t("crew.poll.withdraw")}
          </button>
        )}
        {!poll.anonymous && poll.voters > 0 && (
          <button
            type="button"
            onClick={() => setShowNames((v) => !v)}
            className="flex h-9 items-center rounded-lg px-2 text-[13px] font-semibold text-muted hover:text-foreground"
            aria-expanded={showNames}
          >
            {showNames ? t("crew.poll.hideNames") : t("crew.poll.showNames")}
          </button>
        )}
        {poll.can_manage && (
          <span className="ml-auto flex gap-1.5">
            <button
              type="button"
              onClick={() => setClosed(!poll.closed)}
              disabled={busy}
              className="flex h-9 items-center rounded-lg border border-line-strong px-3 text-[13px] font-semibold disabled:opacity-40"
            >
              {poll.closed ? t("crew.poll.reopen") : t("crew.poll.close")}
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="flex h-9 items-center rounded-lg px-3 text-[13px] font-semibold text-danger hover:bg-danger-card disabled:opacity-40"
            >
              {t("common.delete")}
            </button>
          </span>
        )}
      </div>
      {!poll.can_vote && !poll.closed && <p className="mt-2 text-xs text-muted">{t("crew.poll.membersOnly")}</p>}
      {err && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {err}
        </p>
      )}
    </div>
  );
}

function PollCreateForm({
  eventId,
  postId,
  onDone,
  onCancel,
}: {
  eventId?: string;
  postId?: string;
  onDone: (p: CrewPoll) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [multiple, setMultiple] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [deadline, setDeadline] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const filled = options.map((o) => o.trim()).filter(Boolean);
  const valid = question.trim().length > 0 && new Set(filled).size >= 2;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setErr(null);
    const { data, error } = await createClient().rpc("crew_poll_create", {
      p_event: eventId ?? null,
      p_post: postId ?? null,
      p_question: question.trim(),
      p_options: filled,
      p_multiple: multiple,
      p_anonymous: anonymous,
      // datetime-local 은 이 기기 시간대로 해석된다 — ISO(UTC)로 바꿔 보낸다
      p_closes_at: deadline ? new Date(deadline).toISOString() : null,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    const j = data as CrewPoll & { error?: string };
    if (j?.error) return setErr(errText(t, j.error));
    onDone(j);
  }

  return (
    <form onSubmit={submit} className="flex w-full flex-col gap-3 rounded-2xl bg-surface p-4">
      <p className="text-sm font-bold">{t("crew.poll.create")}</p>
      <label className="flex flex-col gap-1 text-xs text-muted">
        {t("crew.poll.question")}
        <input
          className={input}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={200}
          required
          placeholder={t("crew.poll.questionPh")}
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs text-muted">{t("crew.poll.options")}</legend>
        {options.map((o, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              className={input}
              value={o}
              onChange={(e) => setOptions((os) => os.map((x, j) => (j === i ? e.target.value : x)))}
              maxLength={80}
              placeholder={t("crew.poll.optionPh", { n: i + 1 })}
              aria-label={t("crew.poll.optionPh", { n: i + 1 })}
            />
            {options.length > 2 && (
              <button
                type="button"
                onClick={() => setOptions((os) => os.filter((_, j) => j !== i))}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted hover:text-foreground"
                aria-label={t("crew.poll.removeOption")}
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {options.length < MAX_OPTIONS && (
          <button
            type="button"
            onClick={() => setOptions((os) => [...os, ""])}
            className="self-start text-[13px] font-semibold text-accent hover:underline"
          >
            + {t("crew.poll.addOption")}
          </button>
        )}
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} className="h-4 w-4 accent-accent" />
        {t("crew.poll.allowMultiple")}
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={anonymous}
          onChange={(e) => setAnonymous(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-accent"
        />
        <span>
          {t("crew.poll.anonymousLabel")}
          <span className="block text-xs text-muted">{t("crew.poll.anonymousHint")}</span>
        </span>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        {t("crew.poll.deadline")}
        <input type="datetime-local" className={input} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
      </label>

      {err && (
        <p role="alert" className="text-sm text-danger">
          {err}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-10 rounded-lg px-3 text-sm text-muted hover:text-foreground">
          {t("common.cancel")}
        </button>
        <button
          type="submit"
          disabled={busy || !valid}
          className="h-10 rounded-lg bg-accent px-4 text-sm font-extrabold text-background hover:brightness-110 disabled:opacity-40"
        >
          {busy ? "…" : t("crew.poll.create")}
        </button>
      </div>
    </form>
  );
}
