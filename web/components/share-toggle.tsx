"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

/** 세션 공유 on/off — 소유자만. 공유 시 커뮤니티 피드·공유 링크로 열람 가능 */
export function ShareToggle({ id, shared }: { id: string; shared: boolean }) {
  const router = useRouter();
  const { t } = useI18n();
  const [on, setOn] = useState(shared);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    const next = !on;
    const supabase = createClient();
    const { error } = await supabase
      .from("sessions")
      .update({ shared: next })
      .eq("id", id);
    setBusy(false);
    if (!error) {
      setOn(next);
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={`text-sm hover:underline disabled:opacity-50 ${on ? "text-track" : "text-muted"}`}
      title={t("share.hint")}
    >
      {on ? t("share.shared") : t("share.share")}
    </button>
  );
}
