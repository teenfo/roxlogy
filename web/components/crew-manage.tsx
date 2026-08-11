"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

const input =
  "w-full rounded-md border border-muted/30 bg-background px-3 py-2 text-sm outline-none focus:border-accent";
const label = "mt-4 block text-xs text-muted";

/** 크루 정보 수정 — 크루명·주소는 변경 불가(표시만). 스태프 전용. */
export function CrewInfoForm({
  crew,
}: {
  crew: {
    id: string;
    slug: string;
    name: string;
    tagline: string | null;
    description: string | null;
    location: string | null;
    join_policy: "open" | "approval" | "invite";
    is_public: boolean;
  };
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [tagline, setTagline] = useState(crew.tagline ?? "");
  const [description, setDescription] = useState(crew.description ?? "");
  const [location, setLocation] = useState(crew.location ?? "");
  const [joinPolicy, setJoinPolicy] = useState(crew.join_policy);
  const [isPublic, setIsPublic] = useState(crew.is_public);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("crews")
      .update({
        tagline: tagline.trim() || null,
        description: description.trim() || null,
        location: location.trim() || null,
        join_policy: joinPolicy,
        is_public: isPublic,
      })
      .eq("id", crew.id);
    setBusy(false);
    setMsg(error ? error.message : t("crew.saved"));
    if (!error) router.refresh();
  }

  return (
    <form onSubmit={save}>
      <label className={label}>{t("crew.fName")}</label>
      <input className={`${input} opacity-50`} value={crew.name} disabled />
      <p className="mt-1 text-xs text-muted">{t("crew.nameLocked")}</p>

      <label className={label}>{t("crew.fSlug")}</label>
      <input className={`${input} opacity-50`} value={`/${crew.slug}`} disabled />

      <label className={label}>{t("crew.fTagline")}</label>
      <input className={input} value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={60} />

      <label className={label}>{t("crew.fDesc")}</label>
      <textarea
        className={`${input} min-h-24`}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={2000}
      />

      <label className={label}>{t("crew.fLocation")}</label>
      <input className={input} value={location} onChange={(e) => setLocation(e.target.value)} maxLength={60} />

      <label className={label}>{t("crew.fPolicy")}</label>
      <div className="mt-1 flex gap-2">
        {(
          [
            ["open", t("crew.policyOpen")],
            ["approval", t("crew.policyApproval")],
            ["invite", t("crew.policyInvite")],
          ] as const
        ).map(([v, lbl]) => (
          <button
            key={v}
            type="button"
            onClick={() => setJoinPolicy(v)}
            className={`rounded-full px-3 py-1.5 text-xs ${
              joinPolicy === v
                ? "bg-accent font-bold text-background"
                : "bg-surface text-muted hover:text-foreground"
            }`}
          >
            {lbl}
          </button>
        ))}
      </div>

      <label className="mt-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
        {t("crew.fPublic")}
      </label>

      {msg && <p className="mt-3 text-sm text-muted">{msg}</p>}

      <button
        type="submit"
        disabled={busy}
        className="mt-5 rounded-md bg-accent px-5 py-2.5 text-sm font-bold text-background disabled:opacity-50"
      >
        {t("crew.save")}
      </button>
    </form>
  );
}

export type ManageMember = {
  user_id: string;
  display_name: string;
  role: "owner" | "coach" | "member";
  status: "pending" | "active" | "blocked";
  joined_at: string;
};

/** 멤버 관리 — 가입 신청 승인/거절, 부리더 지정/해제(리더만), 리더 위임, 제외. */
export function CrewMemberManage({
  slug,
  crewId,
  myRole,
  myUserId,
  members,
}: {
  slug: string;
  crewId: string;
  myRole: "owner" | "coach";
  myUserId: string;
  members: ManageMember[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(key: string, fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(key);
    setErr(null);
    const { error } = await fn();
    setBusy(null);
    if (error) setErr(error.message);
    else router.refresh();
  }

  const supabase = () => createClient();
  const approve = (u: string) =>
    run(`a${u}`, () =>
      supabase().from("crew_members").update({ status: "active" }).eq("crew_id", crewId).eq("user_id", u),
    );
  const remove = (u: string, confirmMsg: string) => {
    if (!window.confirm(confirmMsg)) return;
    run(`d${u}`, () =>
      supabase().from("crew_members").delete().eq("crew_id", crewId).eq("user_id", u),
    );
  };
  const setRole = (u: string, role: "coach" | "member") =>
    run(`r${u}`, () => supabase().rpc("set_crew_role", { p_slug: slug, p_user: u, p_role: role }));
  const transfer = (u: string) => {
    if (!window.confirm(t("crew.transferConfirm"))) return;
    run(`t${u}`, () => supabase().rpc("transfer_crew_leader", { p_slug: slug, p_user: u }));
  };

  const roleLabel = (r: string) =>
    r === "owner" ? t("crew.roleOwner") : r === "coach" ? t("crew.roleCoach") : t("crew.roleMember");

  const pending = members.filter((m) => m.status === "pending");
  const active = members.filter((m) => m.status === "active");
  const btn = "rounded-md px-2.5 py-1 text-xs disabled:opacity-50";

  return (
    <div>
      {err && <p className="mb-3 text-sm text-red-400">{err}</p>}

      {pending.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-muted">
            {t("crew.pendingRequests")} ({pending.length})
          </h3>
          <ul className="mt-2 flex flex-col gap-1.5">
            {pending.map((m) => (
              <li key={m.user_id} className="flex items-center justify-between gap-3 rounded-md bg-surface px-4 py-2.5">
                <span className="truncate text-sm">{m.display_name}</span>
                <span className="flex gap-2">
                  <button
                    onClick={() => approve(m.user_id)}
                    disabled={busy != null}
                    className={`${btn} bg-accent font-bold text-background`}
                  >
                    {t("crew.approveMember")}
                  </button>
                  <button
                    onClick={() => remove(m.user_id, t("crew.rejectConfirm"))}
                    disabled={busy != null}
                    className={`${btn} bg-background text-red-400`}
                  >
                    {t("crew.rejectMember")}
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-5" />
        </>
      )}

      <h3 className="text-sm font-semibold text-muted">
        {t("crew.manageMembers")} ({active.length})
      </h3>
      <ul className="mt-2 flex flex-col gap-1.5">
        {active.map((m) => (
          <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface px-4 py-2.5">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm">{m.display_name}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  m.role === "owner"
                    ? "bg-accent/15 text-accent"
                    : m.role === "coach"
                      ? "bg-track/15 text-track"
                      : "bg-background text-muted"
                }`}
              >
                {roleLabel(m.role)}
              </span>
            </span>
            {myRole === "owner" && m.user_id !== myUserId && m.role !== "owner" && (
              <span className="flex flex-wrap gap-2">
                {m.role === "member" ? (
                  <button
                    onClick={() => setRole(m.user_id, "coach")}
                    disabled={busy != null}
                    className={`${btn} bg-background text-track`}
                  >
                    {t("crew.makeCoach")}
                  </button>
                ) : (
                  <button
                    onClick={() => setRole(m.user_id, "member")}
                    disabled={busy != null}
                    className={`${btn} bg-background text-muted`}
                  >
                    {t("crew.demoteCoach")}
                  </button>
                )}
                <button
                  onClick={() => transfer(m.user_id)}
                  disabled={busy != null}
                  className={`${btn} bg-background text-accent`}
                >
                  {t("crew.transferLeader")}
                </button>
                <button
                  onClick={() => remove(m.user_id, t("crew.kickConfirm"))}
                  disabled={busy != null}
                  className={`${btn} bg-background text-red-400`}
                >
                  {t("crew.kick")}
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 크루 삭제 — 리더 전용, 확인 후 삭제하고 목록으로. */
export function CrewDeleteButton({ crewId }: { crewId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function del() {
    if (!window.confirm(t("crew.deleteCrewConfirm"))) return;
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase.from("crews").delete().eq("id", crewId);
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    router.push("/crews");
    router.refresh();
  }

  return (
    <div>
      {err && <p className="mb-2 text-sm text-red-400">{err}</p>}
      <button
        onClick={del}
        disabled={busy}
        className="rounded-md border border-red-400/50 px-4 py-2 text-sm font-semibold text-red-400 hover:bg-red-400/10 disabled:opacity-50"
      >
        {t("crew.deleteCrew")}
      </button>
    </div>
  );
}
