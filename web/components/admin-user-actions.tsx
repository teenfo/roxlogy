"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";

/** 관리자: 특정 사용자의 admin 권한·비활성 토글 (admin RLS 정책으로 허용) — 시안 outline Button 두 개. */
export function AdminUserActions({ userId, isAdmin, disabled }: { userId: string; isAdmin: boolean; disabled: boolean }) {
  const router = useRouter();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // profiles 를 직접 UPDATE 하지 않는다 — 그 경로는 mcp_token 까지 열려 있고
  // 본인 계정을 스스로 잠그는 것도 막지 못한다. RPC 가 둘 다 강제한다.
  async function patch(fields: { is_admin?: boolean; disabled?: boolean }) {
    setBusy(true);
    setErr(null);
    const { error } = await createClient().rpc("admin_update_profile", { p_user: userId, p_patch: fields });
    setBusy(false);
    if (error) setErr(error.message);
    else router.refresh();
  }

  return (
    <span className="rx-actions" style={{ marginTop: 0, flexWrap: "nowrap", justifyContent: "flex-end" }}>
      {err && <span className="rx-error">{err}</span>}
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => patch({ is_admin: !isAdmin })}>
        {isAdmin ? t("admin.revokeAdmin") : t("admin.grantAdmin")}
      </Button>
      <Button type="button" variant="outline" size="sm" className={disabled ? "" : "rx-pft-close"} disabled={busy} onClick={() => patch({ disabled: !disabled })}>
        {disabled ? t("admin.enable") : t("admin.disable")}
      </Button>
    </span>
  );
}
