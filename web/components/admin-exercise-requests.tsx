"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Chip, Empty, Find, Hint } from "@/components/rox/ui";

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
 *  승인하면 exercises 에 추가되고(즉시 워크아웃에 사용 가능) 요청이 종결된다.
 *  시안에 없는 화면(§4) — .rx-record-row 행 + Chip + Button + Find 로만 그린다. */
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

  const approve = (r: ExerciseRequest) => call(r.id, "approve_exercise_request", { p_request: r.id, p_exercise: null, p_name_en: r.name_en });
  const link = (r: ExerciseRequest, exerciseId: string) => call(r.id, "approve_exercise_request", { p_request: r.id, p_exercise: exerciseId, p_name_en: null });
  const reject = (r: ExerciseRequest) => call(r.id, "reject_exercise_request", { p_request: r.id }, false);

  async function searchExercises(id: string, q: string) {
    setLinking({ id, q, hits: [] });
    const term = q.trim();
    if (!term) return;
    const supabase = createClient();
    const { data } = await supabase.from("exercises").select("id, name_ko, name_en").or(`name_ko.ilike.%${term}%,name_en.ilike.%${term}%`).limit(8);
    setLinking((cur) => (cur && cur.id === id && cur.q === q ? { ...cur, hits: (data ?? []) as ExHit[] } : cur));
  }

  if (!items.length) {
    return <Empty title={t("admin.exReqNone")} description={t("admin.exReqDesc")} />;
  }

  return (
    <>
      {err && (
        <p role="alert" className="rx-error">
          {err}
        </p>
      )}
      {notice && <Hint>{notice}</Hint>}
      {items.map((r) => (
        <div key={r.id} className="rx-record-row" style={{ cursor: "default", flexWrap: "wrap" }}>
          {/* 제목 칸 최소 폭 — 좁은 화면에서는 버튼 묶음이 아래 줄로 내려간다(글자가 세로로 쪼개지지 않게) */}
          <span style={{ flex: 1, minWidth: 200 }}>
            <b>
              {r.name_ko}
              {r.name_en ? <small className="rx-muted"> {r.name_en}</small> : null}
            </b>
            <small>
              {r.requester}
              {r.note ? ` · ${r.source !== "user" ? `${t("admin.exReqAiProgram")}: ${r.note}` : r.note}` : ""}
            </small>
          </span>
          {r.source !== "user" && (
            <Chip tone="yellow">
              <span title={t(r.source === "ai" ? "admin.exReqAiHint" : "admin.exReqMcpHint")}>{t(r.source === "ai" ? "admin.exReqAi" : "admin.exReqMcp")}</span>
            </Chip>
          )}
          {r.waitingItems > 0 && (
            <Chip>
              <span title={t("admin.exReqWaitingHint")}>{t("admin.exReqWaiting", { n: r.waitingItems, p: r.waitingPrograms })}</span>
            </Chip>
          )}
          <span className="rx-actions" style={{ marginTop: 0, flexWrap: "nowrap" }}>
            <Button type="button" size="sm" className="rx-primary" onClick={() => approve(r)} disabled={busy != null}>
              {t("admin.exReqApprove")}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => (linking?.id === r.id ? setLinking(null) : searchExercises(r.id, ""))} disabled={busy != null}>
              {linking?.id === r.id ? t("common.cancel") : t("admin.exReqLink")}
            </Button>
            <Button type="button" size="sm" variant="ghost" className="rx-pft-close" onClick={() => reject(r)} disabled={busy != null}>
              {t("admin.exReqReject")}
            </Button>
          </span>
          {linking?.id === r.id && (
            <div style={{ flexBasis: "100%", marginTop: 8 }}>
              <Find value={linking.q} onChange={(v) => searchExercises(r.id, v)} placeholder={t("admin.exReqLinkSearch")} />
              {linking.hits.length > 0 && (
                <div className="rx-actions">
                  {linking.hits.map((ex) => (
                    <Button key={ex.id} type="button" size="sm" variant="outline" onClick={() => link(r, ex.id)} disabled={busy != null}>
                      {locale === "ko" ? ex.name_ko : ex.name_en}
                    </Button>
                  ))}
                </div>
              )}
              <Hint>{t("admin.exReqLinkHint")}</Hint>
            </div>
          )}
        </div>
      ))}
    </>
  );
}
