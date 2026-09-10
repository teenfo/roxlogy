import type { ReactNode } from "react";

/**
 * 설정 화면 공용 프리미티브 (2026-09 프로필 설정 핸드오프).
 *
 * 프로필·계정·연동·알림 네 섹션이 같은 카드/토글/인풋을 쓴다. 컴포넌트마다
 * 클래스 문자열을 되풀이하면 높이·보더가 조금씩 어긋나므로 여기에 모은다.
 * 색은 globals.css 토큰만 쓴다.
 */

/** 섹션 카드 — 헤더(제목·보조설명) + 본문 + 선택적 푸터 바 */
export function SettingsCard({
  id,
  title,
  desc,
  right,
  footer,
  children,
  bodyClassName,
}: {
  /** 좌측 목차·상단 칩이 스크롤해 오는 앵커 */
  id?: string;
  title?: ReactNode;
  desc?: ReactNode;
  right?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /** 리스트형 본문처럼 자체 패딩을 쓰는 경우 통째로 교체 */
  bodyClassName?: string;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-[110px] overflow-hidden rounded-[14px] border border-line bg-card"
    >
      {(title || desc || right) && (
        <div className="flex items-center gap-3 border-b border-line px-[22px] py-[18px] max-md:px-4">
          <div className="min-w-0">
            {title && <h2 className="text-base font-extrabold">{title}</h2>}
            {desc && <p className="mt-0.5 text-xs text-muted">{desc}</p>}
          </div>
          {right && <div className="ml-auto shrink-0">{right}</div>}
        </div>
      )}
      <div
        className={
          bodyClassName ?? "flex flex-col gap-4 px-[22px] py-5 max-md:px-4"
        }
      >
        {children}
      </div>
      {footer && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line bg-inset px-[22px] py-3.5 max-md:px-4">
          {footer}
        </div>
      )}
    </section>
  );
}

/**
 * 스위치 토글. 체크박스보다 상태가 한눈에 보인다.
 * 트랙 자체는 26px 라 터치 타깃이 모자라므로 44px 래퍼 안에 넣는다.
 */
export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** 스크린리더용 — 행 제목을 그대로 넘긴다 */
  label: string;
  disabled?: boolean;
}) {
  return (
    <span className="flex h-11 shrink-0 items-center">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-[26px] w-11 rounded-full transition-colors disabled:opacity-40 ${
          checked ? "bg-accent" : "bg-line-strong"
        }`}
      >
        <span
          aria-hidden
          className={`absolute top-[3px] h-5 w-5 rounded-full transition-all duration-150 ${
            checked ? "left-[21px] bg-background" : "left-[3px] bg-muted"
          }`}
        />
      </button>
    </span>
  );
}

/** 옐로 이니셜 아바타 — 프로필·목차에서 같은 모양을 쓴다 */
export function InitialAvatar({
  name,
  size = 48,
}: {
  name: string;
  size?: number;
}) {
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full bg-accent font-extrabold text-background"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

export const inputCls =
  "h-[42px] w-full min-w-0 rounded-lg border border-line-strong bg-page px-3 text-sm text-foreground outline-none transition-colors focus:border-accent";

export const labelCls = "flex flex-col gap-1.5 text-xs text-muted";

export const btnPrimary =
  "flex h-10 shrink-0 items-center justify-center rounded-lg bg-accent px-4 text-sm font-extrabold text-background transition hover:brightness-110 disabled:opacity-40";

export const btnGhost =
  "flex h-[38px] shrink-0 items-center justify-center rounded-lg border border-line-strong bg-control px-3.5 text-[13px] font-semibold text-foreground transition-colors hover:border-[#555] disabled:opacity-40";

export const btnAccentGhost =
  "flex h-[38px] shrink-0 items-center justify-center rounded-lg border border-line-accent bg-highlight px-3.5 text-[13px] font-bold text-accent transition hover:brightness-125 disabled:opacity-40";

export const btnDanger =
  "flex h-[34px] shrink-0 items-center justify-center rounded-lg border border-danger-line-strong px-3.5 text-[13px] font-semibold text-danger transition-colors hover:bg-danger-card disabled:opacity-40";
