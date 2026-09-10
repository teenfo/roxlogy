"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

/** 모두 읽음 — 본인 행만 (RLS + 명시적 user_id 필터) */
export function MarkNotificationsRead({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function markAll() {
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      setBusy(false);
      return;
    }
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", u.user.id)
      .is("read_at", null);
    setBusy(false);
    if (error) setErr(error.message);
    else router.refresh();
  }

  return (
    <span className={className}>
      <button
        type="button"
        onClick={markAll}
        disabled={busy}
        className="text-[13px] text-muted hover:text-accent disabled:opacity-50"
      >
        {t("notif.markAll")}
      </button>
      {err && <span className="ml-2 text-xs text-danger">{err}</span>}
    </span>
  );
}
