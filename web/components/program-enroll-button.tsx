"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

/** 로컬 기준 오늘 날짜 (YYYY-MM-DD) */
function todayLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

export function ProgramEnrollButton({
  programId,
  initialActive,
}: {
  programId: string;
  initialActive: boolean;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [active, setActive] = useState(initialActive);
  const [pending, setPending] = useState(false);

  async function start() {
    setPending(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setPending(false);
      return;
    }
    // 활성 등록은 1건 — 기존 활성 해제 후 새로 시작
    await supabase
      .from("program_enrollments")
      .update({ active: false })
      .eq("user_id", user.id)
      .eq("active", true);
    const { error } = await supabase.from("program_enrollments").insert({
      user_id: user.id,
      program_id: programId,
      start_date: todayLocal(),
      active: true,
    });
    setPending(false);
    if (!error) {
      setActive(true);
      router.refresh();
    }
  }

  async function stop() {
    setPending(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setPending(false);
      return;
    }
    await supabase
      .from("program_enrollments")
      .update({ active: false })
      .eq("user_id", user.id)
      .eq("program_id", programId)
      .eq("active", true);
    setPending(false);
    setActive(false);
    router.refresh();
  }

  return active ? (
    <div className="flex items-center gap-3">
      <span className="rounded-full bg-track/15 px-3 py-1 text-xs font-semibold text-track">
        {t("programs.enrolled")}
      </span>
      <button
        onClick={stop}
        disabled={pending}
        className="text-xs text-muted hover:text-foreground disabled:opacity-40"
      >
        {t("programs.stop")}
      </button>
    </div>
  ) : (
    <button
      onClick={start}
      disabled={pending}
      className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-background hover:brightness-110 disabled:opacity-40"
    >
      {pending ? t("common.saving") : t("programs.start")}
    </button>
  );
}
