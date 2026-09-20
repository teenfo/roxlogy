"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { dictLabel } from "@/lib/dict-label";
import { Button } from "@/components/ui/button";
import { Person } from "@/components/rox/person";
import { Chip, Find, Hint } from "@/components/rox/ui";

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
 * 시안에 없는 화면(§4) — .rx-record-row 행 · .rx-person · Chip · Find · Button 으로만 그린다.
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
    const { data, error } = await createClient().rpc("find_partner_candidates", { p_q: s });
    setBusy(false);
    if (error) return setErr(error.message);
    setHits((data ?? []) as Candidate[]);
  }

  async function invite(userId: string) {
    setBusy(true);
    setErr(null);
    const { error } = await createClient().rpc("invite_race_partner", { p_plan: planId, p_user: userId });
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
    const { error } = await createClient().from("race_plan_partners").delete().eq("plan_id", planId).eq("user_id", userId);
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  async function respond(accept: boolean) {
    setBusy(true);
    setErr(null);
    const { error } = await createClient().rpc("respond_race_partner", { p_plan: planId, p_accept: accept });
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  const tone: Record<PlanPartner["status"], string> = { accepted: "green", pending: "blue", declined: "red" };
  const already = new Set(partners.map((p) => p.user_id));

  return (
    <div>
      {/* 내가 초대받은 쪽이고 아직 답하지 않았다면 여기서 답한다 */}
      {myStatus === "pending" && (
        <div className="rx-notice">
          <div>
            <b>{t("race.partnerAskYou")}</b>
            <div className="rx-actions">
              <Button type="button" size="sm" className="rx-primary" onClick={() => respond(true)} disabled={busy}>
                {t("race.partnerAccept")}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => respond(false)} disabled={busy}>
                {t("race.partnerDecline")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {partners.length > 0 ? (
        partners.map((p) => (
          <div key={p.user_id} className="rx-record-row" style={{ cursor: "default" }}>
            <Link href={`/u/${p.user_id}`} style={{ flex: 1, minWidth: 0 }}>
              <Person name={p.name} />
            </Link>
            <Chip tone={tone[p.status]}>{t(p.status === "accepted" ? "race.partnerAccepted" : p.status === "declined" ? "race.partnerDeclined" : "race.partnerPending")}</Chip>
            {isOwner && (
              <Button type="button" variant="ghost" size="sm" className="rx-pft-close" onClick={() => remove(p.user_id)} disabled={busy} aria-label={t("common.delete")}>
                ✕
              </Button>
            )}
          </div>
        ))
      ) : (
        <Hint>{t("race.partnerNone")}</Hint>
      )}

      {isOwner && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <div className="rx-actions">
            <Find value={q} onChange={setQ} placeholder={t("race.partnerSearchPh")} />
            <Button type="submit" variant="outline" disabled={busy || !q.trim()}>
              {busy ? "…" : t("raceNew.import.searchBtn")}
            </Button>
          </div>
          <Hint>{t("race.partnerSearchHint")}</Hint>
          {hits && hits.length === 0 && <Hint>{t("race.partnerNoHits")}</Hint>}
          {hits &&
            hits.map((h) => (
              <div key={h.user_id} className="rx-record-row" style={{ cursor: "default" }}>
                <Person name={h.display_name} note={`${t(h.source === "crew" ? "race.srcCrew" : h.source === "follow" ? "race.srcFollow" : "race.srcEmail")}${h.division ? ` · ${dictLabel(t, `division.${h.division}`, h.division)}` : ""}`} />
                <Button type="button" size="sm" variant={already.has(h.user_id) ? "ghost" : "outline"} onClick={() => invite(h.user_id)} disabled={busy || already.has(h.user_id)}>
                  {already.has(h.user_id) ? t("race.partnerAlready") : t("race.partnerInvite")}
                </Button>
              </div>
            ))}
        </form>
      )}

      {err && (
        <p role="alert" className="rx-error">
          {err}
        </p>
      )}
    </div>
  );
}
