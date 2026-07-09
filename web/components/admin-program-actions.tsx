"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

/** 관리자: 공개 프로그램 모더레이션 (비공개 전환·삭제). programs admin RLS로 허용. */
export function AdminProgramActions({ programId }: { programId: string }) {
  const router = useRouter();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  async function unpublish() {
    setBusy(true);
    const supabase = createClient();
    await supabase
      .from("programs")
      .update({ is_public: false })
      .eq("id", programId);
    setBusy(false);
    router.refresh();
  }

  async function remove() {
    if (!window.confirm(t("admin.confirmDeleteProgram"))) return;
    setBusy(true);
    const supabase = createClient();
    await supabase.from("programs").delete().eq("id", programId);
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={unpublish}
        className="rounded-md border border-muted/30 px-2.5 py-1 text-xs font-semibold text-muted hover:text-foreground disabled:opacity-40"
      >
        {t("admin.unpublish")}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={remove}
        className="rounded-md border border-red-400/40 px-2.5 py-1 text-xs font-semibold text-red-400 hover:bg-red-400/10 disabled:opacity-40"
      >
        {t("common.delete")}
      </button>
    </div>
  );
}
