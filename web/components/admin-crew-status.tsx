"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

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
    const { error } = await supabase
      .from("crews")
      .update({ status })
      .eq("id", crewId);
    if (error) {
      setErr(error.message);
      setBusy(false);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => setStatus("active")}
        disabled={busy}
        className="rounded-md bg-accent px-3 py-1.5 text-xs font-bold text-background hover:brightness-110 disabled:opacity-40"
      >
        {t("admin.approve")}
      </button>
      <button
        onClick={() => setStatus("rejected")}
        disabled={busy}
        className="rounded-md bg-surface px-3 py-1.5 text-xs text-red-400 disabled:opacity-50"
      >
        {t("admin.reject")}
      </button>
      {err && <span className="text-xs text-red-400">{err}</span>}
    </div>
  );
}
