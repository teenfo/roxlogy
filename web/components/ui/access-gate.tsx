import Link from "next/link";
import { NavIcon } from "@/components/nav-icon";

/**
 * 권한 차단 화면 공통 형태 (스펙 §18).
 *
 * 다섯 군데에서 같은 일을 하고 있었다 — 정지 계정 · 크루 비로그인 ·
 * 모임 멤버 전용 · 회계 정회원 전용 · 프로필 필수. 화면마다 문구 길이와
 * 버튼 모양이 달라서, 막힌 이유가 "권한" 인지 "오류" 인지 구분이 안 됐다.
 *
 * 규칙은 스펙 그대로다: **잠긴 정보 자체는 보여 주지 않고, 사유와 다음 행동만.**
 * 그래서 이 컴포넌트는 children 을 받지 않는다 — 일부라도 새어 나가지 않게.
 */
export function AccessGate({
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
  /** 정지·오류 계열이면 "alert" — 색만이 아니라 role 도 달라진다 */
  tone?: "neutral" | "alert";
}) {
  return (
    <div
      role={tone === "alert" ? "alert" : undefined}
      className={`flex flex-col items-center gap-3 rounded-[14px] border px-6 py-12 text-center ${
        tone === "alert"
          ? "border-danger-line bg-danger-card"
          : "border-line bg-card"
      }`}
    >
      <NavIcon
        name="target"
        className={`h-7 w-7 ${tone === "alert" ? "text-danger" : "text-muted-3"}`}
      />
      <h2 className="text-base font-bold">{title}</h2>
      <p className="max-w-sm text-sm leading-relaxed text-muted [word-break:keep-all]">
        {reason}
      </p>
      {action && (
        <Link
          href={action.href}
          className="mt-2 flex h-[42px] items-center rounded-[10px] bg-accent px-[17px] text-sm font-bold text-accent-foreground transition hover:brightness-95 max-md:h-12"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
