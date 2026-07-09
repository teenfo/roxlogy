"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

/** 관리자: 세션 리더보드 노출 제외·soft delete (admin RLS 정책으로 허용) */
export function AdminSessionActions({
  sessionId,
  excluded,
}: {
  sessionId: string;
  excluded: boolean;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState(false);

  async function toggleExclude() {
    setBusy(true);
    const supabase = createClient();
    await supabase
      .from("sessions")
      .update({ leaderboard_excluded: !excluded })
      .eq("id", sessionId);
    setBusy(false);
    router.refresh();
  }

  async function softDelete() {
    if (!window.confirm(t("admin.confirmDeleteSession"))) return;
    setBusy(true);
    const supabase = createClient();
    await supabase
      .from("sessions")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", sessionId);
    setBusy(false);
    setRemoved(true);
    router.refresh();
  }

  if (removed) return <span className="text-xs text-muted">{t("admin.removed")}</span>;

  return (
    <div className="flex items-center justify-end gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={toggleExclude}
        className={`rounded-md border px-2.5 py-1 text-xs font-semibold disabled:opacity-40 ${
          excluded
            ? "border-track/40 text-track hover:bg-track/10"
            : "border-muted/30 text-muted hover:text-foreground"
        }`}
      >
        {excluded ? t("admin.unhideLb") : t("admin.hideLb")}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={softDelete}
        className="rounded-md border border-red-400/40 px-2.5 py-1 text-xs font-semibold text-red-400 hover:bg-red-400/10 disabled:opacity-40"
      >
        {t("common.delete")}
      </button>
    </div>
  );
}
