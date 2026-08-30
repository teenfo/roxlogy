"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import {
  buildSessionRows,
  toIngestPayload,
  type IngestResult,
  raceSplitsToForms,
  type RaceSplits,
} from "@/lib/session-builder";

/** 배번(4+2: HHMM+순번) → 웨이브 출발시각 "HH:MM:00". 형식이 다르면 null */
function bibStartClock(bib: string | null): string | null {
  const m = String(bib ?? "").match(/^(\d{2})(\d{2})\d{2}$/);
  if (!m) return null;
  if (Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${m[1]}:${m[2]}:00`;
}

/**
 * 등록된 레이스 결과를 세션으로 변환하는 버튼 (레이스 상세 페이지용).
 * 이미 이 레이스로 만든 세션이 있으면 그 세션으로 이동한다(중복 방지).
 * 시작 시각은 배번에 인코딩된 웨이브 출발시각(앞 4자리 HHMM)을 우선 사용.
 */
export function RaceToSessionButton({
  raceId,
  division,
  eventDate,
  bib = null,
  splits,
}: {
  raceId: string;
  division: string | null;
  eventDate: string | null;
  bib?: string | null;
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
    const startClock = bibStartClock(bib) ?? "09:00:00";
    const startIso = eventDate
      ? new Date(`${eventDate}T${startClock}`).toISOString()
      : new Date().toISOString();
    const built = buildSessionRows(user.id, startIso, forms, {
      division,
      raceResultId: raceId,
    });
    if ("error" in built) {
      setPending(false);
      return setError(t("races.toSessionEmpty"));
    }

    // ingest_session 단일 진입점 (LWW 가드 + 세그먼트 스냅샷)
    const { data: res, error: rErr } = await supabase.rpc("ingest_session", {
      p: toIngestPayload(built),
    });
    if (rErr) {
      setPending(false);
      return setError(rErr.message);
    }
    if (!(res as IngestResult | null)?.applied) {
      setPending(false);
      return setError(t("session.staleConflict"));
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
        className="rounded-md border border-accent/50 px-3 py-1.5 text-sm font-semibold text-accent hover:bg-accent/10 disabled:opacity-40"
      >
        {pending ? t("common.saving") : t("races.toSession")}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
