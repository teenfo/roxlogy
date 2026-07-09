"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

/** 저장된 목표 삭제 (인플레이스 갱신). goal_plans owner RLS로 허용. */
export function GoalDeleteButton({ goalId }: { goalId: string }) {
  const router = useRouter();
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  async function del() {
    setPending(true);
    const supabase = createClient();
    await supabase.from("goal_plans").delete().eq("id", goalId);
    setPending(false);
    router.refresh();
  }

  if (!confirming)
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs text-muted hover:text-red-400"
      >
        {t("common.delete")}
      </button>
    );
  return (
    <span className="flex items-center gap-2 text-xs">
      <button
        type="button"
        onClick={del}
        disabled={pending}
        className="font-semibold text-red-400 disabled:opacity-50"
      >
        {pending ? t("common.deleting") : t("common.confirmDelete")}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="text-muted">
        {t("common.cancel")}
      </button>
    </span>
  );
}
