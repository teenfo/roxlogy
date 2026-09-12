"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { Avatar } from "@/components/ui/crew-ui";
import { dictLabel } from "@/lib/dict-label";

export type PlanPartner = {
  user_id: string;
  name: string;
  status: "pending" | "accepted" | "declined";
};

type Candidate = {
  user_id: string;
  display_name: string;
  division: string | null;
  source: "crew" | "follow" | "email";
};

/**
 * 더블·릴레이 파트너 — 계획 소유자가 초대하고, 상대가 수락한다.
 *
 * 검색 범위는 DB(find_partner_candidates)가 정한다: 이름으로는 내 크루원과
 * 내가 팔로우하는 사람만, 그 밖의 사람은 이메일 정확 일치로만. 이름으로 전체
 * 사용자를 훑을 수 있게 하면 가입자 목록이 공개된 셈이 된다.
 */
export function RacePartnerBox({
  planId,
  partners,
  isOwner,
  myStatus,
}: {
  planId: string;
  partners: PlanPartner[];
  isOwner: boolean;
  /** 내가 초대받은 쪽이면 내 응답 상태 */
  myStatus: "pending" | "accepted" | "declined" | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function search() {
    const s = q.trim();
    if (!s) return;
    setBusy(true);
    setErr(null);
    const { data, error } = await createClient().rpc("find_partner_candidates", {
      p_q: s,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setHits((data ?? []) as Candidate[]);
  }

  async function invite(userId: string) {
    setBusy(true);
    setErr(null);
    const { error } = await createClient().rpc("invite_race_partner", {
      p_plan: planId,
      p_user: userId,
    });
    setBusy(false);
    if (error) return setErr(t("race.partnerInviteErr"));
    setQ("");
    setHits(null);
    router.refresh();
  }

  async function remove(userId: string) {
    if (!window.confirm(t("race.partnerRemoveConfirm"))) return;
    setBusy(true);
    setErr(null);
    const { error } = await createClient()
      .from("race_plan_partners")
      .delete()
      .eq("plan_id", planId)
      .eq("user_id", userId);
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  async function respond(accept: boolean) {
    setBusy(true);
    setErr(null);
    const { error } = await createClient().rpc("respond_race_partner", {
      p_plan: planId,
      p_accept: accept,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  const tone: Record<PlanPartner["status"], string> = {
    accepted: "bg-success-bg text-success",
    pending: "bg-label-bg text-label",
    declined: "bg-danger-bg text-danger",
  };
  const already = new Set(partners.map((p) => p.user_id));

  return (
    <div className="flex flex-col gap-3">
      {/* 내가 초대받은 쪽이고 아직 답하지 않았다면 여기서 답한다 */}
      {myStatus === "pending" && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line-accent bg-highlight px-4 py-3">
          <p className="min-w-0 flex-1 text-[13px] [word-break:keep-all]">
            {t("race.partnerAskYou")}
          </p>
          <button
            type="button"
            onClick={() => respond(true)}
            disabled={busy}
            className="flex h-9 items-center rounded-lg bg-accent px-4 text-[13px] font-extrabold text-background transition hover:brightness-110 disabled:opacity-40"
          >
            {t("race.partnerAccept")}
          </button>
          <button
            type="button"
            onClick={() => respond(false)}
            disabled={busy}
            className="flex h-9 items-center rounded-lg border border-line-strong px-3.5 text-[13px] font-semibold text-muted transition-colors hover:text-danger disabled:opacity-40"
          >
            {t("race.partnerDecline")}
          </button>
        </div>
      )}

      {partners.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {partners.map((p) => (
            <li
              key={p.user_id}
              className="flex items-center gap-3 rounded-xl border border-line bg-card px-4 py-2.5"
            >
              <Avatar name={p.name} size={32} />
              <Link
                href={`/u/${p.user_id}`}
                className="min-w-0 flex-1 truncate text-sm font-bold hover:text-accent"
              >
                {p.name}
              </Link>
              <span
                className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-bold ${tone[p.status]}`}
              >
                {t(
                  p.status === "accepted"
                    ? "race.partnerAccepted"
                    : p.status === "declined"
                      ? "race.partnerDeclined"
                      : "race.partnerPending",
                )}
              </span>
              {isOwner && (
                <button
                  type="button"
                  onClick={() => remove(p.user_id)}
                  disabled={busy}
                  className="shrink-0 text-muted transition-colors hover:text-danger disabled:opacity-40"
                  aria-label={t("common.delete")}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted">{t("race.partnerNone")}</p>
      )}

      {isOwner && (
        <>
          <div className="flex gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void search();
                }
              }}
              placeholder={t("race.partnerSearchPh")}
              className="h-10 w-full min-w-0 rounded-lg border border-line-strong bg-page px-3 text-sm outline-none transition-colors focus:border-accent"
            />
            <button
              type="button"
              onClick={search}
              disabled={busy || !q.trim()}
              className="flex h-10 shrink-0 items-center rounded-lg border border-line-strong bg-control px-4 text-[13px] font-semibold transition-colors hover:border-line-strong disabled:opacity-40"
            >
              {busy ? "…" : t("raceNew.import.searchBtn")}
            </button>
          </div>
          <p className="text-xs text-muted [word-break:keep-all]">
            {t("race.partnerSearchHint")}
          </p>

          {hits && hits.length === 0 && (
            <p className="text-[13px] text-muted">{t("race.partnerNoHits")}</p>
          )}
          {hits && hits.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {hits.map((h) => (
                <li key={h.user_id}>
                  <button
                    type="button"
                    onClick={() => invite(h.user_id)}
                    disabled={busy || already.has(h.user_id)}
                    className="flex w-full items-center gap-3 rounded-lg border border-line bg-page px-3 py-2 text-left transition-colors hover:border-line-accent disabled:opacity-40"
                  >
                    <Avatar name={h.display_name} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-bold">
                        {h.display_name}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {t(
                          h.source === "crew"
                            ? "race.srcCrew"
                            : h.source === "follow"
                              ? "race.srcFollow"
                              : "race.srcEmail",
                        )}
                        {h.division
                          ? ` · ${dictLabel(t, `division.${h.division}`, h.division)}`
                          : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-[13px] font-bold text-accent">
                      {already.has(h.user_id)
                        ? t("race.partnerAlready")
                        : t("race.partnerInvite")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {err && <p role="alert" className="text-xs text-danger">{err}</p>}
    </div>
  );
}
