"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

/** 관리자: 특정 사용자의 admin 권한·비활성 토글 (admin RLS 정책으로 허용) */
export function AdminUserActions({
  userId,
  isAdmin,
  disabled,
}: {
  userId: string;
  isAdmin: boolean;
  disabled: boolean;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  async function patch(fields: { is_admin?: boolean; disabled?: boolean }) {
    setBusy(true);
    const supabase = createClient();
    await supabase.from("profiles").update(fields).eq("id", userId);
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => patch({ is_admin: !isAdmin })}
        className={`rounded-md border px-2.5 py-1 text-xs font-semibold disabled:opacity-40 ${
          isAdmin
            ? "border-accent/40 text-accent hover:bg-accent/10"
            : "border-muted/30 text-muted hover:text-foreground"
        }`}
      >
        {isAdmin ? t("admin.revokeAdmin") : t("admin.grantAdmin")}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => patch({ disabled: !disabled })}
        className={`rounded-md border px-2.5 py-1 text-xs font-semibold disabled:opacity-40 ${
          disabled
            ? "border-track/40 text-track hover:bg-track/10"
            : "border-red-400/40 text-red-400 hover:bg-red-400/10"
        }`}
      >
        {disabled ? t("admin.enable") : t("admin.disable")}
      </button>
    </div>
  );
}
