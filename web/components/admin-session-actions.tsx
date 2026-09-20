"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/rox/ui";

/** 관리자: 세션 리더보드 노출 제외·soft delete (admin RLS 정책으로 허용) — 시안 모더레이션 표의 outline Button. */
export function AdminSessionActions({ sessionId, excluded }: { sessionId: string; excluded: boolean }) {
  const router = useRouter();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggleExclude() {
    setBusy(true);
    setErr(null);
    const { error } = await createClient().from("sessions").update({ leaderboard_excluded: !excluded }).eq("id", sessionId);
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  async function softDelete() {
    if (!window.confirm(t("admin.confirmDeleteSession"))) return;
    setBusy(true);
    setErr(null);
    const { error } = await createClient().from("sessions").update({ deleted_at: new Date().toISOString() }).eq("id", sessionId);
    setBusy(false);
    if (error) return setErr(error.message);
    setRemoved(true);
    router.refresh();
  }

  if (removed) return <Chip>{t("admin.removed")}</Chip>;

  return (
    <span className="rx-actions" style={{ marginTop: 0, flexWrap: "nowrap", justifyContent: "flex-end" }}>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={toggleExclude}>
        {excluded ? t("admin.unhideLb") : t("admin.hideLb")}
      </Button>
      <Button type="button" variant="ghost" size="sm" className="rx-pft-close" disabled={busy} onClick={softDelete}>
        {t("common.delete")}
      </Button>
      {err && <span className="rx-error">{err}</span>}
    </span>
  );
}
