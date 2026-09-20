"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import type { ShellCrew } from "@/lib/shell";
import { Field, Hint } from "@/components/rox/ui";

/**
 * 사이드바 푸터에 고정할 크루 고르기 (PORT_PLAN §7-5, 마이그레이션 111).
 * 크루가 둘 이상일 때만 의미가 있다 — 하나뿐이면 렌더하지 않는다.
 * profiles.sidebar_crew_id 를 본인 행에만 쓴다(RLS profiles_update).
 */
export function SidebarCrewSelect({
  userId,
  crews,
  current,
}: {
  userId: string;
  crews: (ShellCrew & { id: string })[];
  /** 현재 고정된 크루 id. null = 자동 */
  current: string | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [value, setValue] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (crews.length < 2) return null;

  async function change(next: string) {
    setValue(next);
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ sidebar_crew_id: next || null })
      .eq("id", userId);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <Field label={t("shell.sidebarCrew")}>
        <select
          value={value}
          disabled={saving}
          onChange={(e) => change(e.target.value)}
          className="rx-locale"
          style={{ maxWidth: "none", width: "100%" }}
        >
          <option value="">{t("shell.sidebarCrewAuto")}</option>
          {crews.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Hint>{error ?? t("shell.sidebarCrewHint")}</Hint>
    </div>
  );
}
