"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";

/** 관리자: 공개 프로그램 모더레이션 (비공개 전환·삭제). programs admin RLS로 허용. */
export function AdminProgramActions({ programId }: { programId: string }) {
  const router = useRouter();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function unpublish() {
    setBusy(true);
    setErr(null);
    const { error } = await createClient().from("programs").update({ is_public: false }).eq("id", programId);
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  async function remove() {
    if (!window.confirm(t("admin.confirmDeleteProgram"))) return;
    setBusy(true);
    setErr(null);
    const { error } = await createClient().from("programs").delete().eq("id", programId);
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <span className="rx-actions" style={{ marginTop: 0, flexWrap: "nowrap" }}>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={unpublish}>
        {t("admin.unpublish")}
      </Button>
      <Button type="button" variant="ghost" size="sm" className="rx-pft-close" disabled={busy} onClick={remove}>
        {t("common.delete")}
      </Button>
      {err && <span className="rx-error">{err}</span>}
    </span>
  );
}
