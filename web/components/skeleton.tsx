"use client";
import { useI18n } from "@/components/i18n-provider";

/** Twenty-two layout recipes, shared by route loading boundaries. */
export const skeletonRecipes = {
  dashboard: ["kpis", "detail", "chart"],
  sessionList: ["filters", "rows"], sessionDetail: ["kpis", "chart", "rows"],
  form: ["form"], raceList: ["filters", "cards"], raceDetail: ["kpis", "detail", "chart"],
  schedule: ["filters", "calendar"], racePlan: ["hero", "detail"],
  programList: ["filters", "cards"], programDetail: ["hero", "rows", "rows"],
  workout: ["hero", "rows"], run: ["kpis", "filters", "rows"],
  exercise: ["filters", "cards"], pft: ["kpis", "rows"],
  staff: ["pair", "cards"], board: ["hero", "board"],
  crewList: ["filters", "cards"], crewDetail: ["hero", "detail", "rows"],
  crewBoard: ["filters", "rows"], finance: ["kpis", "detail"],
  profile: ["profile", "form"], adminDetail: ["profile", "kpis", "rows"],
} as const;
export type SkeletonVariant = keyof typeof skeletonRecipes;

function Lines({ count = 3 }: { count?: number }) {
  return <>{Array.from({ length: count }, (_, i) => <div key={i} className="rx-skeleton-line" style={{ width: `${[72, 92, 48][i % 3]}%` }} />)}</>;
}
function Panel({ children }: { children: React.ReactNode }) { return <div className="rx-skeleton-panel">{children}</div>; }
function Shape({ type, cards }: { type: string; cards: number }) {
  switch (type) {
    case "filters": return <div className="flex gap-3"><div className="rx-skeleton-row w-48" /><div className="rx-skeleton-row w-28" /></div>;
    case "kpis": return <div className="rx-skeleton-kpis">{Array.from({ length: 4 }, (_, i) => <Panel key={i}><Lines count={2} /></Panel>)}</div>;
    case "cards": return <div className="rx-skeleton-grid">{Array.from({ length: cards }, (_, i) => <Panel key={i}><div className="rx-skeleton-row" /><Lines /></Panel>)}</div>;
    case "rows": return <Panel>{Array.from({ length: 5 }, (_, i) => <div className="rx-skeleton-row" key={i} />)}</Panel>;
    case "chart": return <Panel><Lines count={1} /><div className="rx-skeleton-chart" /></Panel>;
    case "hero": return <Panel><Lines count={2} /><div className="rx-skeleton-row w-1/3" /></Panel>;
    case "profile": return <Panel><div className="rx-skeleton-avatar" /><Lines count={2} /></Panel>;
    case "calendar": return <Panel><div className="grid grid-cols-7 gap-2">{Array.from({ length: 35 }, (_, i) => <div className="h-16 rounded bg-inset" key={i} />)}</div></Panel>;
    case "form": return <div className="rx-skeleton-detail"><Panel>{Array.from({ length: 4 }, (_, i) => <div key={i}><Lines count={1} /><div className="rx-skeleton-row mt-3" /></div>)}</Panel><Panel><Lines /><div className="rx-skeleton-row mt-4" /></Panel></div>;
    case "pair": return <div className="grid gap-6 md:grid-cols-2"><Panel><Lines /><div className="rx-skeleton-chart" /></Panel><Panel><Lines /><div className="rx-skeleton-chart" /></Panel></div>;
    case "board": return <div className="rx-skeleton-grid">{Array.from({ length: 3 }, (_, i) => <Panel key={i}><Lines /><div className="h-64" /></Panel>)}</div>;
    default: return <div className="rx-skeleton-detail"><Shape type="rows" cards={cards} /><Panel><Lines /><div className="rx-skeleton-row" /></Panel></div>;
  }
}
export function PageSkeleton({ cards = 3, label, variant = "sessionList" }: { cards?: number; label?: string; variant?: SkeletonVariant }) {
  const { t } = useI18n();
  const text = label ?? t("common.loading");
  return <div className="rx-skeleton" data-skeleton={variant} role="status" aria-label={text} aria-busy="true">
    <div aria-hidden className="rx-skeleton motion-safe:animate-pulse">
      <div className="rx-skeleton-title" />
      {skeletonRecipes[variant].map((type, i) => <Shape key={i} type={type} cards={cards} />)}
    </div><span className="sr-only">{text}</span>
  </div>;
}
