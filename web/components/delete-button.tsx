"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

/** 세션 soft delete 또는 레이스 결과 삭제 — 확인 단계 포함 */
export function DeleteButton({
  kind,
  id,
  redirectTo,
}: {
  kind: "session" | "race";
  id: string;
  redirectTo: string;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleDelete() {
    setPending(true);
    const supabase = createClient();
    if (kind === "session") {
      // soft delete — 오프라인 재동기화 부활 방지 (deleted_at tombstone)
      await supabase
        .from("sessions")
        .update({
          deleted_at: new Date().toISOString(),
          client_updated_at: new Date().toISOString(),
        })
        .eq("id", id);
    } else {
      await supabase.from("race_results").delete().eq("id", id);
    }
    router.push(redirectTo);
    router.refresh();
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="text-sm text-muted hover:text-red-400"
      >
        {t("common.delete")}
      </button>
    );
  }
  return (
    <span className="flex items-center gap-3 text-sm">
      <span className="text-muted">{t("common.confirmDelete")}</span>
      <button
        onClick={handleDelete}
        disabled={pending}
        className="font-semibold text-red-400 disabled:opacity-50"
      >
        {pending ? t("common.deleting") : t("common.delete")}
      </button>
      <button onClick={() => setConfirming(false)} className="text-muted">
        {t("common.cancel")}
      </button>
    </span>
  );
}
