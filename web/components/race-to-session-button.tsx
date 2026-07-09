"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import {
  buildSessionRows,
  raceSplitsToForms,
  type RaceSplits,
} from "@/lib/session-builder";

/**
 * 등록된 레이스 결과를 세션으로 변환하는 버튼 (레이스 상세 페이지용).
 * 이미 이 레이스로 만든 세션이 있으면 그 세션으로 이동한다(중복 방지).
 */
export function RaceToSessionButton({
  raceId,
  division,
  eventDate,
  splits,
}: {
  raceId: string;
  division: string | null;
  eventDate: string | null;
  splits: RaceSplits;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function convert() {
    setPending(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setPending(false);
      return setError(t("common.needLogin"));
    }

    // 이미 이 레이스로 만든 세션이 있으면 그리로 이동
    const { data: existing } = await supabase
      .from("sessions")
      .select("id")
      .eq("race_result_id", raceId)
      .is("deleted_at", null)
      .maybeSingle();
    if (existing) {
      router.push(`/sessions/${existing.id}`);
      return;
    }

    const forms = raceSplitsToForms(splits);
    const startIso = eventDate
      ? new Date(`${eventDate}T09:00:00`).toISOString()
      : new Date().toISOString();
    const built = buildSessionRows(user.id, startIso, forms, {
      division,
      raceResultId: raceId,
    });
    if ("error" in built) {
      setPending(false);
      return setError(t("races.toSessionEmpty"));
    }

    const { error: sErr } = await supabase
      .from("sessions")
      .upsert(built.session, { onConflict: "id" });
    const { error: gErr } = sErr
      ? { error: sErr }
      : await supabase
          .from("session_segments")
          .upsert(built.segments, { onConflict: "session_id,seq" });
    if (sErr || gErr) {
      setPending(false);
      return setError((sErr ?? gErr)!.message);
    }
    router.push(`/sessions/${built.session.id}`);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={convert}
        disabled={pending}
        className="rounded-md border border-accent/40 px-3 py-1.5 text-sm font-semibold text-accent hover:bg-accent/10 disabled:opacity-40"
      >
        {pending ? t("common.saving") : t("races.toSession")}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
