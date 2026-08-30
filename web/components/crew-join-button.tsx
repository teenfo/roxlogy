"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

/** 크루 가입/탈퇴 — join_crew RPC 는 open 정책이면 즉시 active, 아니면 pending.
 *  탈퇴·신청 취소는 crew_members 본인 행 삭제(crew_members_leave_self 정책).
 *  리더는 위임 전에는 탈퇴할 수 없다(서버 트리거로도 막힘). */
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
    const { data: crewId, error: idErr } = await supabase.rpc(
      "crew_id_by_slug",
      { p_slug: slug },
    );
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

  if (!loggedIn)
    return (
      <a
        href={`/login?next=/crews/${slug}`}
        className="rounded-md border border-accent/50 px-4 py-2 text-sm font-semibold text-accent hover:bg-accent/10"
      >
        {t("crew.loginToJoin")}
      </a>
    );

  if (status === "active" || status === "pending") {
    const isOwner = role === "owner";
    const label = status === "active" ? t("crew.joined") : t("crew.pending");
    const action = status === "active" ? t("crew.leave") : t("crew.cancelJoin");
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-muted/40 px-4 py-2 text-sm font-semibold text-muted">
            {label}
          </span>
          {!isOwner &&
            (confirming ? (
              <span className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={leave}
                  disabled={busy}
                  className="font-semibold text-red-400 disabled:opacity-50"
                >
                  {busy ? t("common.deleting") : t("crew.leaveConfirm")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="text-muted"
                >
                  {t("common.cancel")}
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="text-xs text-muted hover:text-red-400"
              >
                {action}
              </button>
            ))}
        </div>
        {isOwner && (
          <p className="max-w-48 text-right text-xs text-muted">
            {t("crew.ownerCannotLeave")}
          </p>
        )}
        {err && <p className="text-xs text-red-400">{err}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={join}
        disabled={busy}
        className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-background hover:brightness-110 disabled:opacity-40"
      >
        {busy ? t("crew.joining") : t("crew.join")}
      </button>
      {err && <p className="text-xs text-red-400">{err}</p>}
    </div>
  );
}
