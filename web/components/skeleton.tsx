/** 로딩 스켈레톤 — 실제 레이아웃 모양(제목 + 카드 몇 장)으로 자리를 잡아
 *  데이터가 늦어도 화면이 비어 보이지 않게 한다 (UI 감사 2026-09-12 P2).
 *  motion-safe 에서만 깜빡인다. */
export function PageSkeleton({
  cards = 3,
  label = "Loading",
}: {
  cards?: number;
  label?: string;
}) {
  return (
    <div role="status" aria-label={label} aria-busy="true" className="flex flex-col gap-4">
      <div className="h-7 w-40 rounded-md bg-line motion-safe:animate-pulse" />
      <div className="h-4 w-64 max-w-full rounded bg-line-soft motion-safe:animate-pulse" />
      {Array.from({ length: cards }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col gap-3 rounded-[14px] border border-line bg-card p-4 motion-safe:animate-pulse"
        >
          <div className="h-4 w-1/3 rounded bg-line" />
          <div className="h-3 w-2/3 rounded bg-line-soft" />
          <div className="h-3 w-1/2 rounded bg-line-soft" />
        </div>
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}
