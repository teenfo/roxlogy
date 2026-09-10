import Link from "next/link";

/**
 * 크루 화면 공용 프리미티브 (2026-09 디자인 핸드오프).
 *
 * 7개 탭이 같은 배지·칩·카드·아바타를 반복해서 쓴다. 탭마다 클래스 문자열을
 * 손으로 되풀이하면 색이 조금씩 어긋나므로 여기 한 곳에 모은다.
 * 색은 globals.css 토큰만 쓴다 — 하드코딩 금지.
 */

export type Tone = "accent" | "info" | "danger" | "success" | "label" | "neutral";

const TONE: Record<Tone, string> = {
  accent: "bg-accent/15 text-accent",
  info: "bg-info-bg text-info",
  danger: "bg-danger-bg text-danger",
  success: "bg-success-bg text-success",
  label: "bg-label-bg text-label",
  neutral: "bg-line text-muted",
};

/** 상태 배지 */
export function Badge({
  tone = "neutral",
  outline = false,
  children,
  className = "",
}: {
  tone?: Tone;
  outline?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const base = outline ? "border border-line-accent text-accent" : TONE[tone];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold leading-none ${base} ${className}`}
    >
      {children}
    </span>
  );
}

/** 필터 칩 — 활성은 옐로 채움, 비활성은 아웃라인. href 를 주면 링크로 동작한다. */
export function Chip({
  active = false,
  href,
  onClick,
  count,
  children,
}: {
  active?: boolean;
  href?: string;
  /** 클라이언트 필터용 — 칩 전체가 버튼이 된다 (여백까지 클릭 영역) */
  onClick?: () => void;
  count?: number;
  children: React.ReactNode;
}) {
  const cls = `inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition-colors ${
    active
      ? "bg-accent text-background"
      : "border border-line-strong text-muted hover:border-muted/60 hover:text-foreground"
  }`;
  const body = (
    <>
      {children}
      {count != null && (
        <span className={active ? "opacity-70" : "text-muted/70"}>{count}</span>
      )}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={cls}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={active} className={cls}>
        {body}
      </button>
    );
  }
  return <span className={cls}>{body}</span>;
}

/** 카드 — highlight 면 옐로 강조(다음 모임·누적 잔액 등) */
export function Card({
  highlight = false,
  className = "",
  children,
}: {
  highlight?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-2xl border ${
        highlight ? "border-line-accent bg-highlight" : "border-line bg-card"
      } ${className}`}
    >
      {children}
    </div>
  );
}

/** 섹션 제목 + 우측 액션 */
export function SectionHead({
  title,
  badge,
  right,
}: {
  title: string;
  badge?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <h2 className="text-[19px] font-extrabold">{title}</h2>
      {badge}
      {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
    </div>
  );
}

/** 이니셜 아바타. 이름 해시로 색을 고정해 같은 사람은 늘 같은 색이 된다. */
const AVATAR_COLORS = [
  "#ffd500",
  "#f4a261",
  "#8ecae6",
  "#b5e48c",
  "#e0aaff",
  "#ffafcc",
];

export function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function Avatar({
  name,
  size = 36,
  className = "",
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-extrabold text-background ${className}`}
      style={{
        width: size,
        height: size,
        background: avatarColor(name),
        fontSize: Math.round(size * 0.42),
      }}
    >
      {initial}
    </span>
  );
}

/** 아바타 스택 — 최대 max 명까지 겹쳐 보여주고 나머지는 +N */
export function AvatarStack({
  names,
  max = 3,
  size = 26,
}: {
  names: string[];
  max?: number;
  size?: number;
}) {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return (
    <span className="flex items-center">
      {shown.map((n, i) => (
        <Avatar
          key={i}
          name={n}
          size={size}
          className={`ring-2 ring-card ${i > 0 ? "-ml-2" : ""}`}
        />
      ))}
      {rest > 0 && (
        <span
          className="-ml-2 inline-flex items-center justify-center rounded-full bg-line text-[10px] font-bold text-muted ring-2 ring-card"
          style={{ width: size, height: size }}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}

/** 진행 바 — 출석률 등. 100% 초록 / 50%↑ 옐로 / 미만 빨강 */
export function ProgressBar({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  const color = pct >= 100 ? "bg-success" : pct >= 50 ? "bg-accent" : "bg-danger";
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-full min-w-10 overflow-hidden rounded-full bg-line">
        <span className={`block h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="tabular shrink-0 text-[13px] font-bold">
        {value}/{total}
      </span>
    </span>
  );
}
