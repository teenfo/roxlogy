"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Chip, Go } from "@/components/rox/ui";

/** 크루 가입/탈퇴 — join_crew RPC 는 open 정책이면 즉시 active, 아니면 pending.
 *  탈퇴·신청 취소는 crew_members 본인 행 삭제(crew_members_leave_self 정책).
 *  리더는 위임 전에는 탈퇴할 수 없다(서버 트리거로도 막힘).
 *  시안에는 없는 우리 기능 — 시안 버튼·칩으로만 그린다(PORT_PLAN §4). */
export function CrewJoinButton({
  slug,
  status,
  role,
  loggedIn,
}: {
  slug: string;
  status: "pending" | "active" | "blocked" | null;
  role?: string | null;
  loggedIn: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function join() {
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("join_crew", { p_slug: slug });
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  async function leave() {
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      return setErr(t("common.needLogin"));
    }
    const { data: crewId, error: idErr } = await supabase.rpc("crew_id_by_slug", { p_slug: slug });
    if (idErr || !crewId) {
      setBusy(false);
      return setErr(idErr?.message ?? t("crew.leaveFailed"));
    }
    const { error } = await supabase
      .from("crew_members")
      .delete()
      .eq("crew_id", crewId)
      .eq("user_id", user.id);
    setBusy(false);
    if (error) return setErr(error.message);
    setConfirming(false);
    router.refresh();
  }

  if (!loggedIn) return <Go href={`/login?next=/crews/${slug}`}>{t("crew.loginToJoin")}</Go>;

  if (status === "active" || status === "pending") {
    const isOwner = role === "owner";
    return (
      <div className="rx-actions">
        <Chip tone={status === "active" ? "green" : "yellow"}>
          {status === "active" ? t("crew.joined") : t("crew.pending")}
        </Chip>
        {!isOwner &&
          (confirming ? (
            <>
              <Button variant="outline" size="sm" className="rx-pft-close" onClick={leave} disabled={busy}>
                {busy ? t("common.deleting") : t("crew.leaveConfirm")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                {t("common.cancel")}
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
              {status === "active" ? t("crew.leave") : t("crew.cancelJoin")}
            </Button>
          ))}
        {err && (
          <span role="alert" className="rx-error">
            {err}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="rx-actions">
      <Button className="rx-primary" onClick={join} disabled={busy}>
        {busy ? t("crew.joining") : t("crew.join")}
      </Button>
      {err && (
        <span role="alert" className="rx-error">
          {err}
        </span>
      )}
    </div>
  );
}
