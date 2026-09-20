"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { duesErrText } from "@/lib/dues-error";

type Result = { targets: number; sent: number; recent: number; optout: number };

/**
 * 미납 알림 보내기 (회계 > 회비 탭 "확인할 일" 카드).
 *
 * `notify_unpaid_dues` 가 이 달 미납자에게 알림을 인큐하고 push-dispatch 크론이
 * 실제로 보낸다. RPC 는 대상·발송·건너뜀을 나눠 돌려주므로 그대로 적는다 —
 * "N명에게 보냈습니다" 라고만 하면 알림을 꺼 둔 사람까지 받은 것처럼 읽힌다.
 *
 * 같은 달 독촉은 6시간 안에 두 번 나가지 않는다(RPC 가 막는다). 그래서 두 번째
 * 누름은 실패가 아니라 "최근에 보낸 N명은 건너뛰었습니다" 로 돌아온다.
 */
export function CrewDuesNotify({
  crewId,
  period,
  count,
}: {
  crewId: string;
  /** YYYY-MM */
  period: string;
  /** 미납 인원 — 확인 문구에 쓴다 */
  count: number;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    if (!window.confirm(t("crew.duesNotifyConfirm", { n: count }))) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    const { data, error } = await createClient().rpc("notify_unpaid_dues", {
      p_crew: crewId,
      p_period: period,
    });
    setBusy(false);
    if (error) return setErr(duesErrText(t, error.message));
    const r = (data ?? {}) as Partial<Result>;
    const parts: string[] = [];
    if (r.sent) parts.push(t("crew.duesNotifySent", { n: r.sent }));
    if (r.recent) parts.push(t("crew.duesNotifySkipped", { n: r.recent }));
    if (r.optout) parts.push(t("crew.duesNotifyOptout", { n: r.optout }));
    setMsg(parts.length ? parts.join(" · ") : t("crew.duesNotifyNone"));
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void send()}
        disabled={busy}
        className="flex h-9 items-center justify-center rounded-lg border border-danger-line px-3 text-[13px] font-bold text-danger hover:bg-danger-card disabled:opacity-50"
      >
        {busy ? t("crew.duesNotifySending") : t("crew.duesNotify")}
      </button>
      {err && (
        <p role="alert" className="text-xs text-danger">
          {err}
        </p>
      )}
      {msg && <p className="text-xs text-foreground/80">{msg}</p>}
    </>
  );
}
