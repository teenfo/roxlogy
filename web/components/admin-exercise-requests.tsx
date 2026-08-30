"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

export type ExerciseRequest = {
  id: string;
  name_ko: string;
  name_en: string | null;
  note: string | null;
  created_at: string;
  requester: string;
};

/** 운동 등록 요청 처리 — 관리자 전용.
 *  승인하면 exercises 에 추가되고(즉시 워크아웃에 사용 가능) 요청이 종결된다. */
export function AdminExerciseRequests({ items }: { items: ExerciseRequest[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function resolve(r: ExerciseRequest, approve: boolean) {
    setBusy(r.id);
    setErr(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (approve) {
      const { error } = await supabase.from("exercises").insert({
        name_ko: r.name_ko,
        name_en: r.name_en ?? r.name_ko,
      });
      if (error) {
        setErr(error.message);
        setBusy(null);
        return;
      }
    }
    const { error } = await supabase
      .from("exercise_requests")
      .update({
        status: approve ? "approved" : "rejected",
        resolved_at: new Date().toISOString(),
        resolved_by: user?.id ?? null,
      })
      .eq("id", r.id);
    setBusy(null);
    if (error) setErr(error.message);
    else router.refresh();
  }

  if (!items.length) {
    return <p className="text-sm text-muted">{t("admin.exReqNone")}</p>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {err && <p className="text-sm text-red-400">{err}</p>}
      {items.map((r) => (
        <div
          key={r.id}
          className="flex min-w-0 flex-wrap items-center gap-2 rounded-md bg-surface px-4 py-2.5"
        >
          <span className="text-sm font-semibold">{r.name_ko}</span>
          {r.name_en && <span className="text-xs text-muted">{r.name_en}</span>}
          {r.note && (
            <span className="min-w-0 flex-1 truncate text-xs text-muted">
              {r.note}
            </span>
          )}
          <span className="ml-auto shrink-0 text-xs text-muted">
            {r.requester}
          </span>
          <button
            onClick={() => resolve(r, true)}
            disabled={busy != null}
            className="shrink-0 rounded-md bg-accent px-3 py-1 text-xs font-bold text-background disabled:opacity-40"
          >
            {t("admin.exReqApprove")}
          </button>
          <button
            onClick={() => resolve(r, false)}
            disabled={busy != null}
            className="shrink-0 rounded-md bg-background px-3 py-1 text-xs text-red-400 disabled:opacity-40"
          >
            {t("admin.exReqReject")}
          </button>
        </div>
      ))}
    </div>
  );
}
