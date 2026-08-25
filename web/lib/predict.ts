import { STATIONS } from "./hyrox";

/**
 * 목표 시간 → 세그먼트별 목표 스플릿 역산.
 *
 * 배분 모델(v2):
 *  - 스테이션 비중은 레벨별 실측 근사표(공개 스플릿 중앙값 기반)를 기본으로 하고,
 *    사용자의 시뮬 세션 기록이 있으면 개인 비율을 70% 가중으로 블렌딩한다 —
 *    개인의 강점/약점(예: 월볼이 유난히 느림)이 제안에 그대로 반영된다.
 *  - 런/스테이션 비중·록스존 예산도 개인 기록이 있으면 그것을 따른다.
 */

export const LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type Level = (typeof LEVELS)[number];

const ROXZONE_BUDGET_MS: Record<Level, number> = {
  beginner: 7 * 60_000,
  intermediate: 5.5 * 60_000,
  advanced: 4 * 60_000,
};

const DEFAULT_RUN_SHARE = 0.52;

/** 레벨별 스테이션 배분(스테이션 합 대비 비율) — 공개 스플릿 중앙값 근사.
 *  초심자일수록 월볼·버피·슬레드풀 비중이 커지고 스키/로우는 상대적으로 안정적. */
const LEVEL_STATION_SHARE: Record<Level, Record<string, number>> = {
  advanced: {
    ski: 0.115, sledpush: 0.105, sledpull: 0.135, burpee: 0.125,
    row: 0.115, farmers: 0.075, lunges: 0.135, wallballs: 0.175,
  },
  intermediate: {
    ski: 0.11, sledpush: 0.11, sledpull: 0.145, burpee: 0.135,
    row: 0.11, farmers: 0.075, lunges: 0.135, wallballs: 0.18,
  },
  beginner: {
    ski: 0.105, sledpush: 0.11, sledpull: 0.15, burpee: 0.145,
    row: 0.105, farmers: 0.07, lunges: 0.135, wallballs: 0.19,
  },
};

/** 사용자 세션 기록에서 뽑은 개인 배분 프로필 */
export type PersonalProfile = {
  /** 스테이션 합 대비 각 스테이션 비율 (관측된 키만) */
  stationRatios: Record<string, number>;
  /** (록스존 제외) 런 비중 — run / (run + stations) */
  runShare: number | null;
  /** 총합 대비 록스존 비중 */
  roxShare: number | null;
  sessionCount: number;
};

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 최근 시뮬 세션들(스테이션 6개 이상 기록된 것)에서 개인 배분 프로필 산출 */
export function personalFromSessions(
  sessions: {
    stations: Record<string, number>;
    runTotalMs: number;
    roxTotalMs: number;
    total: number;
  }[],
): PersonalProfile | null {
  const usable = sessions
    .filter((s) => Object.values(s.stations).filter((v) => v > 0).length >= 6)
    .slice(0, 8);
  if (!usable.length) return null;

  // 스테이션별: 각 세션 내 비율의 중앙값
  const perKey: Record<string, number[]> = {};
  const runShares: number[] = [];
  const roxShares: number[] = [];
  for (const s of usable) {
    const stationSum = Object.values(s.stations).reduce(
      (a, v) => a + (v > 0 ? v : 0),
      0,
    );
    if (stationSum <= 0) continue;
    for (const [k, v] of Object.entries(s.stations)) {
      if (v > 0) (perKey[k] ??= []).push(v / stationSum);
    }
    if (s.runTotalMs > 0)
      runShares.push(s.runTotalMs / (s.runTotalMs + stationSum));
    if (s.roxTotalMs > 0 && s.total > 0) roxShares.push(s.roxTotalMs / s.total);
  }
  const stationRatios: Record<string, number> = {};
  for (const [k, arr] of Object.entries(perKey)) {
    const m = median(arr);
    if (m != null) stationRatios[k] = m;
  }
  if (Object.keys(stationRatios).length < 6) return null;
  return {
    stationRatios,
    runShare: median(runShares),
    roxShare: median(roxShares),
    sessionCount: usable.length,
  };
}

export type PredictResult = {
  runLapMs: number; // 1km당
  runTotalMs: number;
  stations: { key: string; nameKo: string; targetMs: number }[];
  stationTotalMs: number;
  roxzoneTotalMs: number;
  roxzoneEachMs: number; // 8회 평균
  personalized: boolean; // 개인 기록이 배분에 반영됐는지
};

export type AchievabilityTier =
  | "aggressive"
  | "challenging"
  | "realistic"
  | "comfortable";

/**
 * 목표 시간의 현실성 티어 (S14) — 레벨별 통상 완주 시간대(분) 기준 정성 안내.
 * 실측 백분위(race_benchmarks 기반)는 별도로 함께 표시한다.
 */
const LEVEL_BANDS_MIN: Record<Level, { fast: number; typical: number; easy: number }> = {
  // fast=상위권 근접, typical=중앙값대, easy=여유 (분)
  beginner: { fast: 80, typical: 95, easy: 110 },
  intermediate: { fast: 66, typical: 78, easy: 90 },
  advanced: { fast: 56, typical: 64, easy: 74 },
};

export function achievabilityTier(
  targetTotalMs: number,
  level: Level,
): AchievabilityTier {
  const min = targetTotalMs / 60_000;
  const b = LEVEL_BANDS_MIN[level];
  if (min < b.fast) return "aggressive";
  if (min < b.typical) return "challenging";
  if (min < b.easy) return "realistic";
  return "comfortable";
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

export function predictSplits(
  targetTotalMs: number,
  level: Level,
  personal: PersonalProfile | null = null,
): PredictResult | null {
  // 록스존: 개인 비중이 있으면 그것(3~9분 클램프), 없으면 레벨 예산
  const roxzoneTotalMs = Math.round(
    personal?.roxShare != null
      ? clamp(targetTotalMs * personal.roxShare, 3 * 60_000, 9 * 60_000)
      : ROXZONE_BUDGET_MS[level],
  );
  const remaining = targetTotalMs - roxzoneTotalMs;
  if (remaining <= 0) return null;

  // 런/스테이션 비중: 개인 실측(0.42~0.62 클램프) 우선
  const runShare =
    personal?.runShare != null
      ? clamp(personal.runShare, 0.42, 0.62)
      : DEFAULT_RUN_SHARE;
  const runTotalMs = Math.round(remaining * runShare);
  const stationTotalMs = remaining - runTotalMs;

  // 스테이션 배분: 레벨 실측표 + 개인 비율(70%) 블렌딩 후 정규화
  const levelShare = LEVEL_STATION_SHARE[level];
  const personalized = !!personal;
  const blended = STATIONS.map((s) => {
    const base = levelShare[s.key] ?? 0.12;
    const mine = personal?.stationRatios[s.key];
    return { key: s.key, nameKo: s.nameKo, w: mine != null ? 0.7 * mine + 0.3 * base : base };
  });
  const wSum = blended.reduce((a, b) => a + b.w, 0);

  return {
    runLapMs: Math.round(runTotalMs / 8),
    runTotalMs,
    stations: blended.map((b) => ({
      key: b.key,
      nameKo: b.nameKo,
      targetMs: Math.round((stationTotalMs * b.w) / wSum),
    })),
    stationTotalMs,
    roxzoneTotalMs,
    roxzoneEachMs: Math.round(roxzoneTotalMs / 8),
    personalized,
  };
}
