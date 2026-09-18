/**
 * 앱 공용 프리미티브 — 디자인 스펙 1.3 §05 의 컴포넌트 계약.
 *
 * 화면마다 제목·패널·필터·표를 손으로 되풀이하면 크기와 간격이 조금씩 어긋난다.
 * 스펙이 정한 치수를 여기 한 곳에 박아 두고 화면은 조립만 한다.
 *
 * 기존 것과의 관계:
 * - `components/ui/crew-ui.tsx` 의 Badge = 스펙의 상태 Chip, Chip = 필터 칩,
 *   Card ≒ Panel. 크루 화면이 이미 쓰고 있어 그대로 두고, 여기서는 크루 밖
 *   화면이 쓸 것만 정의한다.
 * - `components/ui/settings-ui.tsx` 의 버튼 클래스는 설정 화면 전용이라 남긴다.
 *
 * 색은 토큰만 쓴다 — 하드코딩 금지(2026-09-18 리뉴얼에서 380곳을 걷어냈다).
 */
import Link from "next/link";
import { NavIcon } from "@/components/nav-icon";

/* ── 페이지 머리 ─────────────────────────────────────────────── */

/** 제목 + 설명 + 주 행동. 스펙: 30px/750/-1px, ≤1000px 27px, ≤600px 25px */
export function PageHead({
  title,
  description,
  action,
  back,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-[27px]">
      {back && <Back href={back.href} label={back.label} />}
      <div className="flex items-center justify-between gap-5 max-sm:flex-wrap">
        <div className="min-w-0">
          <h1 className="text-[30px] font-extrabold leading-[1.4] tracking-[-1px] max-[1000px]:text-[27px] max-[600px]:text-[25px]">
            {title}
          </h1>
          {description && (
            <p className="mt-[7px] text-sm text-muted">{description}</p>
          )}
        </div>
        {action}
      </div>
    </div>
  );
}

/** 상위 목록으로 돌아가는 링크 */
export function Back({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="mb-2 inline-flex items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-foreground"
    >
      <span aria-hidden>←</span>
      {label}
    </Link>
  );
}

/** 버튼 모양 링크. primary 는 브랜드 옐로 면 + 어두운 글자(10.06:1) */
export function Go({
  href,
  children,
  primary = false,
}: {
  href: string;
  children: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <Link href={href} className={primary ? btnPrimary : btnOutline}>
      {children}
    </Link>
  );
}

/* ── 버튼·입력 클래스 (스펙 §05·§06) ─────────────────────────── */

/** 주요 버튼: 높이 42px / 좌우 17px / 14px·700. 모바일은 최소 48px */
export const btnPrimary =
  "inline-flex h-[42px] shrink-0 items-center justify-center rounded-[10px] bg-accent px-[17px] text-sm font-bold text-accent-foreground transition hover:brightness-95 disabled:pointer-events-none disabled:opacity-50 max-md:h-12";

/** 보조 버튼 — 외곽선 */
export const btnOutline =
  "inline-flex h-[42px] shrink-0 items-center justify-center rounded-[10px] border border-line-strong bg-card px-[17px] text-sm font-semibold text-foreground transition hover:bg-card-hover disabled:pointer-events-none disabled:opacity-50 max-md:h-11";

/** 덜 중요한 작업 — 테두리 없음 */
export const btnGhost =
  "inline-flex h-[42px] shrink-0 items-center justify-center rounded-[10px] px-3 text-sm font-semibold text-muted transition hover:bg-card-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-50 max-md:h-11";

/** 일반 입력: 높이 42px / 14px. 모바일은 16px — 16px 미만이면 iOS 가 확대한다 */
export const inputCls =
  "h-[42px] w-full rounded-[10px] border border-line-strong bg-card px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-3 focus:border-focus max-md:h-12 max-md:text-base";

/** 필드 라벨: 14px / 650 */
export const labelCls = "block text-sm font-semibold text-foreground";

/* ── 면 ──────────────────────────────────────────────────────── */

/** 흰 패널 — 반경 14px / 1px 경계 / 안쪽 24px (≤600px 20px) */
export function Panel({
  title,
  action,
  className = "",
  children,
}: {
  title?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-[14px] border border-line bg-card p-6 max-[600px]:p-5 ${className}`}
    >
      {title && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-bold">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** 요약 지표 4열 — ≤1000px 2열. note 는 단위·비교 조건을 적는 자리다 */
export function Stats({ items }: { items: [label: string, value: string, note?: string][] }) {
  return (
    <div className="mb-[25px] grid grid-cols-4 gap-4 max-[1000px]:grid-cols-2 max-[600px]:gap-3">
      {items.map(([label, value, note]) => (
        <div
          key={label}
          className="min-w-0 rounded-xl border border-line bg-card px-5 py-[18px]"
        >
          <span className="block text-[13px] text-muted">{label}</span>
          <strong className="tabular mt-1 block text-[clamp(20px,2vw,27px)] font-extrabold leading-tight max-[600px]:text-[21px]">
            {value}
          </strong>
          {note && <p className="mt-1 text-xs text-muted-3">{note}</p>}
        </div>
      ))}
    </div>
  );
}

/* ── 폼 ──────────────────────────────────────────────────────── */

/** 라벨 + 입력. 아래 22px, 라벨 아래 8px */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mb-[22px] block">
      <span className={`${labelCls} mb-2`}>{label}</span>
      {children}
      {hint && <Hint>{hint}</Hint>}
    </label>
  );
}

/** 항목 옆 보조 설명 */
export function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1.5 text-xs text-muted">{children}</p>;
}

/* ── 목록 ────────────────────────────────────────────────────── */

/**
 * 실제 `<table>` 구조. 좁은 화면에서는 **패널 안에서만** 가로로 스크롤한다 —
 * 페이지 전체가 옆으로 밀리면 안 된다(스펙 §11 reflow).
 */
export function DataTable({
  headers,
  rows,
  scrollHint,
}: {
  headers: string[];
  rows: React.ReactNode[][];
  /** 넘칠 때만 보여줄 안내 — 스펙 모바일 §03 */
  scrollHint?: string;
}) {
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line">
              {headers.map((h) => (
                <th
                  key={h}
                  scope="col"
                  className="h-11 px-3 text-left text-xs font-semibold text-muted"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-line-soft last:border-0">
                {r.map((c, j) => (
                  <td
                    key={j}
                    className={`px-3 py-[17px] align-top ${j === 0 ? "min-w-[160px] font-semibold" : ""}`}
                  >
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {scrollHint && (
        <p className="mt-2 text-xs text-muted-3 md:hidden">{scrollHint}</p>
      )}
    </div>
  );
}

/** 비어 있는 이유와 다음 행동. "데이터 없음"과 "검색 결과 없음"은 다른 문구다 */
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[14px] border border-line bg-card px-6 py-14 text-center">
      <NavIcon name="diamond" className="h-8 w-8 text-muted-3" />
      <h3 className="text-base font-bold">{title}</h3>
      <p className="max-w-sm text-sm text-muted">{description}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** 진행률 — 값과 접근 가능한 이름을 함께 준다 */
export function ProgressBar({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-2 w-full overflow-hidden rounded-full bg-inset"
    >
      <div className="h-full rounded-full bg-accent-dim" style={{ width: `${pct}%` }} />
    </div>
  );
}
