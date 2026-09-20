"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";

/** 관리자 크루 승인/거절 버튼 — crews.status 변경은 관리자만 가능(트리거 가드). */
export function AdminCrewStatus({ crewId }: { crewId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function setStatus(status: "active" | "rejected") {
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase.from("crews").update({ status }).eq("id", crewId);
    if (error) {
      setErr(error.message);
      setBusy(false);
      return;
    }
    router.refresh();
  }

  return (
    <span className="rx-actions" style={{ marginTop: 0, flexWrap: "nowrap" }}>
      <Button type="button" size="sm" className="rx-primary" onClick={() => setStatus("active")} disabled={busy}>
        {t("admin.approve")}
      </Button>
      <Button type="button" size="sm" variant="ghost" className="rx-pft-close" onClick={() => setStatus("rejected")} disabled={busy}>
        {t("admin.reject")}
      </Button>
      {err && <span className="rx-error">{err}</span>}
    </span>
  );
}
