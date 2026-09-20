import { Skeleton } from "@/components/ui/skeleton";

/**
 * 로딩 스켈레톤 — 시안 loading-states.tsx 의 LoadingSkeleton 그대로 (스펙 §20).
 *
 * 시안은 22개 화면을 나열하지만 실제 뼈대는 아홉 가지다 — metrics · list · detail ·
 * form · calendar · cards · staff · finance · board. 라우트의 loading.tsx 가 그 화면의
 * 뼈대(shape)와 줄 수(cards)를 고른다. 이름은 시안 것을 따르되, 예전 이름
 * dashboard(=metrics)도 받는다.
 *
 * 접근성: 바깥에 role="status" + aria-busy, 안쪽 장식 블록은 전부 aria-hidden,
 * 실제 읽히는 건 sr-only 라벨 하나. 깜빡임(rx-pulse)은 시안 CSS 가 reduced-motion
 * 에서 멈춘다.
 */
export type SkeletonShape =
  | "metrics"
  | "dashboard"
  | "list"
  | "detail"
  | "form"
  | "calendar"
  | "cards"
  | "staff"
  | "finance"
  | "board";

export function PageSkeleton({
  shape = "list",
  cards = 3,
  label = "Loading",
  head = true,
}: {
  shape?: SkeletonShape;
  /** 목록/폼의 줄 수 — 실제 화면과 비슷하게 */
  cards?: number;
  label?: string;
  /** 제목 자리를 그릴지. 보드처럼 제목이 없는 화면은 끈다 */
  head?: boolean;
}) {
  const type = shape === "dashboard" ? "metrics" : shape;
  const count = cards;
  const rows = (n: number, cls: string) =>
    Array.from({ length: n }, (_, i) => <Skeleton className={cls} key={i} />);

  return (
    <section
      className={"rx-loading rx-loading-" + type}
      role="status"
      aria-label={label}
      aria-busy="true"
    >
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">
        {head && (
          <>
            <Skeleton className="rx-sk-title" />
            <Skeleton className="rx-sk-sub" />
          </>
        )}
        <div className="rx-sk-layout">
          {type === "calendar" ? (
            <>
              <div className="rx-sk-week">
                {Array.from({ length: 7 }, (_, i) => (
                  <Skeleton key={i} />
                ))}
              </div>
              <div className="rx-sk-panel">{rows(count, "rx-sk-row")}</div>
            </>
          ) : type === "form" ? (
            <>
              <div className="rx-sk-panel rx-sk-form">
                {Array.from({ length: count }, (_, i) => (
                  <div key={i}>
                    <Skeleton className="rx-sk-label" />
                    <Skeleton className="rx-sk-input" />
                  </div>
                ))}
              </div>
              <div className="rx-sk-panel">
                <Skeleton className="rx-sk-total" />
                <Skeleton className="rx-sk-input" />
              </div>
            </>
          ) : type === "list" ? (
            <div className="rx-sk-panel">
              <Skeleton className="rx-sk-input" />
              {Array.from({ length: count }, (_, i) => (
                <div className="rx-sk-list-row" key={i}>
                  <Skeleton className="rx-sk-avatar" />
                  <div>
                    <Skeleton className="rx-sk-line" />
                    <Skeleton className="rx-sk-label" />
                  </div>
                  <Skeleton className="rx-sk-amount" />
                </div>
              ))}
            </div>
          ) : type === "detail" || type === "finance" ? (
            <>
              <div className="rx-sk-panel rx-sk-hero">
                <Skeleton className="rx-sk-total" />
                <Skeleton className="rx-sk-sub" />
              </div>
              <div className="rx-sk-panel">{rows(count, "rx-sk-row")}</div>
              <div className="rx-sk-panel">
                <Skeleton className="rx-sk-chart" />
                <Skeleton className="rx-sk-input" />
              </div>
            </>
          ) : (
            Array.from({ length: count }, (_, i) => (
              <div key={i} className="rx-sk-panel">
                <Skeleton className="rx-sk-label" />
                <Skeleton
                  className={type === "cards" ? "rx-sk-chart" : "rx-sk-total"}
                />
                <Skeleton className="rx-sk-line" />
                {type !== "metrics" && (
                  <>
                    <Skeleton className="rx-sk-row" />
                    <Skeleton className="rx-sk-input" />
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
