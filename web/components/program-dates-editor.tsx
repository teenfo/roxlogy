"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

/** 소유자용: 반복(순환) 옵션 편집.
 *  프로그램은 순수 템플릿 — 시작/종료일은 프로그램이 아니라 등록(개인)·
 *  크루 연결에 속한다. 여기서는 템플릿 속성인 반복 여부만 다룬다. */
export function ProgramDatesEditor({
  programId,
  initialRepeat = false,
}: {
  programId: string;
  initialRepeat?: boolean;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [repeat, setRepeat] = useState(initialRepeat);
  const [pending, setPending] = useState(false);

  async function toggle(next: boolean) {
    setRepeat(next);
    setPending(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("programs")
      .update({ repeat_enabled: next })
      .eq("id", programId);
    setPending(false);
    if (error) setRepeat(!next);
    else router.refresh();
  }

  return (
    <div className="mt-4 rounded-md bg-surface px-4 py-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={repeat}
          disabled={pending}
          onChange={(e) => toggle(e.target.checked)}
        />
        {t("programs.repeatLabel")}
      </label>
      {repeat && (
        <p className="mt-1.5 text-xs text-muted">{t("programs.repeatHint")}</p>
      )}
    </div>
  );
}
