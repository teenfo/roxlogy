import type { ReactNode } from "react";

/**
 * 시안의 `.rx-person` 행 — 아바타(이니셜) + 이름(+ 보조 줄) + 우측 칩.
 * crew.tsx MemberList · account.tsx Feed 가 손으로 쓰던 마크업을 한 곳에 모은다.
 * 옛 `components/ui/crew-ui.tsx` 의 Avatar 를 대신한다(PORT_PLAN §4 — 시안 프리미티브만 쓴다).
 */
export function Person({
  name,
  note,
  chip,
  size,
}: {
  name: string;
  /** 이름 아래 작은 줄 — 이메일·상태 등 */
  note?: ReactNode;
  /** 이름 옆에 붙는 칩(등급·권한) — `.rx-person > .rx-chip` 은 우측 정렬된다 */
  chip?: ReactNode;
  /** 아바타 지름(px). 기본 32 */
  size?: number;
}) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span className="rx-person">
      <span className="rx-avatar" aria-hidden style={size ? { width: size, height: size } : undefined}>
        {initial}
      </span>
      <span style={{ minWidth: 0 }}>
        {name}
        {note && <small>{note}</small>}
      </span>
      {chip}
    </span>
  );
}
