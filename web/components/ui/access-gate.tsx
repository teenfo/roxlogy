import { LockKeyhole } from "lucide-react";
import { getT } from "@/lib/i18n";
import { Go } from "@/components/rox/ui";

/**
 * 권한 차단 화면 — 시안 GateScreen 그대로 (.rx-state-page, 스펙 §18).
 * 정지 계정 · 크루 비로그인 · 모임 멤버 전용 · 회계 정회원 전용 · 프로필 필수.
 *
 * 규칙은 스펙 그대로다: **잠긴 정보 자체는 보여 주지 않고, 사유와 다음 행동만.**
 * 그래서 이 컴포넌트는 children 을 받지 않는다 — 일부라도 새어 나가지 않게.
 */
export async function AccessGate({
  title,
  reason,
  action,
  tone = "neutral",
}: {
  /** 무엇이 막혔는지 */
  title: string;
  /** 왜 막혔는지 — 한 문장 */
  reason: string;
  /** 다음 행동 하나. 없으면 안내만 남는다 */
  action?: { href: string; label: string };
  /** 정지·오류 계열이면 "alert" — role 이 달라진다 */
  tone?: "neutral" | "alert";
}) {
  const { t } = await getT();
  return (
    <section className="rx-state-page" role={tone === "alert" ? "alert" : undefined}>
      <div>
        <span className={"rx-state-icon " + (tone === "alert" ? "warning" : "")}>
          <LockKeyhole />
        </span>
        <span className="rx-kicker">{t("gate.access")}</span>
        <h1>{title}</h1>
        <p>{reason}</p>
        {action && (
          <Go href={action.href} primary>
            {action.label}
          </Go>
        )}
      </div>
    </section>
  );
}
