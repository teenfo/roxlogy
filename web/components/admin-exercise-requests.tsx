"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

export type ExerciseRequest = {
  id: string;
  name_ko: string;
  name_en: string | null;
  /** AI 요청이면 프로그램 제목, 사용자 요청이면 입력한 메모 */
  note: string | null;
  /** "ai" = AI 프로그램 생성, "mcp" = MCP 프로그램 등록이 자동으로 남김, "user" = 사람이 직접 요청 */
  source: "ai" | "mcp" | "user";
  /** 이 요청을 기다리는 프로그램 항목 수 / 프로그램 수 (승인하면 자동으로 채워진다) */
  waitingItems: number;
  waitingPrograms: number;
  created_at: string;
  requester: string;
};

/** 운동 등록 요청 처리 — 관리자 전용.
 *  승인하면 exercises 에 추가되고(즉시 워크아웃에 사용 가능) 요청이 종결된다. */
export function AdminExerciseRequests({ items }: { items: ExerciseRequest[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // "기존 운동으로 연결" 모드 — 요청 id 별 검색어와 후보
  const [linking, setLinking] = useState<{ id: string; q: string; hits: ExHit[] } | null>(null);

  type ExHit = { id: string; name_ko: string; name_en: string };
  type Result = { ok?: boolean; error?: string; items_filled?: number } | null;

  /** 승인(새 운동 또는 기존 운동 연결)·거절은 RPC 로 — 서버 트리거가 대기 중인
   *  프로그램 항목을 같은 트랜잭션에서 채운다(마이그레이션 090). */
  async function call(id: string, fn: string, args: Record<string, unknown>, filledMsg = true) {
    setBusy(id);
    setErr(null);
    setNotice(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc(fn, args);
    setBusy(null);
    if (error) {
      setErr(error.message);
      return;
    }
    const r = data as Result;
    if (r?.error) {
      setErr(r.error);
      return;
    }
    if (filledMsg && r?.items_filled != null) {
      setNotice(t("admin.exReqFilled", { n: r.items_filled }));
    }
    setLinking(null);
    router.refresh();
  }

  const approve = (r: ExerciseRequest) =>
    call(r.id, "approve_exercise_request", {
      p_request: r.id,
      p_exercise: null,
      p_name_en: r.name_en,
    });
  const link = (r: ExerciseRequest, exerciseId: string) =>
    call(r.id, "approve_exercise_request", {
      p_request: r.id,
      p_exercise: exerciseId,
      p_name_en: null,
    });
  const reject = (r: ExerciseRequest) =>
    call(r.id, "reject_exercise_request", { p_request: r.id }, false);

  async function searchExercises(id: string, q: string) {
    setLinking({ id, q, hits: [] });
    const term = q.trim();
    if (!term) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("exercises")
      .select("id, name_ko, name_en")
      .or(`name_ko.ilike.%${term}%,name_en.ilike.%${term}%`)
      .limit(8);
    setLinking((cur) =>
      cur && cur.id === id && cur.q === q ? { ...cur, hits: (data ?? []) as ExHit[] } : cur,
    );
  }

  if (!items.length) {
    return <p className="text-sm text-muted">{t("admin.exReqNone")}</p>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {err && <p role="alert" className="text-sm text-red-400">{err}</p>}
      {notice && <p role="status" className="text-sm text-accent">{notice}</p>}
      {items.map((r) => (
        <div key={r.id} className="rounded-md bg-surface px-4 py-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {r.source !== "user" && (
              <span
                title={t(r.source === "ai" ? "admin.exReqAiHint" : "admin.exReqMcpHint")}
                className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent"
              >
                {t(r.source === "ai" ? "admin.exReqAi" : "admin.exReqMcp")}
              </span>
            )}
            <span className="text-sm font-semibold">{r.name_ko}</span>
            {r.name_en && <span className="text-xs text-muted">{r.name_en}</span>}
            {r.waitingItems > 0 && (
              <span
                title={t("admin.exReqWaitingHint")}
                className="shrink-0 rounded-md border border-line-mid bg-background px-1.5 py-0.5 text-xs font-bold tabular"
              >
                {t("admin.exReqWaiting", { n: r.waitingItems, p: r.waitingPrograms })}
              </span>
            )}
            {r.note && (
              <span className="min-w-0 flex-1 truncate text-xs text-muted">
                {r.source !== "user" ? `${t("admin.exReqAiProgram")}: ${r.note}` : r.note}
              </span>
            )}
            <span className="ml-auto shrink-0 text-xs text-muted">{r.requester}</span>
            <button
              onClick={() => approve(r)}
              disabled={busy != null}
              className="shrink-0 rounded-md bg-accent px-3 py-1 text-xs font-bold text-background hover:brightness-110 disabled:opacity-40"
            >
              {t("admin.exReqApprove")}
            </button>
            <button
              onClick={() =>
                linking?.id === r.id ? setLinking(null) : searchExercises(r.id, "")
              }
              disabled={busy != null}
              className="shrink-0 rounded-md bg-background px-3 py-1 text-xs disabled:opacity-40"
            >
              {linking?.id === r.id ? t("common.cancel") : t("admin.exReqLink")}
            </button>
            <button
              onClick={() => reject(r)}
              disabled={busy != null}
              className="shrink-0 rounded-md bg-background px-3 py-1 text-xs text-red-400 disabled:opacity-40"
            >
              {t("admin.exReqReject")}
            </button>
          </div>
          {linking?.id === r.id && (
            <div className="mt-2 flex flex-col gap-1.5">
              <input
                autoFocus
                value={linking.q}
                onChange={(e) => searchExercises(r.id, e.target.value)}
                placeholder={t("admin.exReqLinkSearch")}
                className="h-9 w-full rounded-md border border-line-strong bg-page px-3 text-sm outline-none focus:border-accent"
              />
              {linking.hits.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {linking.hits.map((ex) => (
                    <button
                      key={ex.id}
                      onClick={() => link(r, ex.id)}
                      disabled={busy != null}
                      className="rounded-md border border-line-mid bg-background px-2.5 py-1 text-xs hover:border-accent disabled:opacity-40"
                    >
                      {locale === "ko" ? ex.name_ko : ex.name_en}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted">{t("admin.exReqLinkHint")}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
