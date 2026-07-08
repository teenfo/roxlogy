import { STATIONS } from "./hyrox";

/**
 * 목표 시간 → 세그먼트별 목표 스플릿 역산.
 * 공개 페이스 캘큘레이터들(TrainRox·HyroxDataLab·PaceRox)의 통상 분포를
 * 참고한 근사치: 록스존 예산을 레벨별로 떼어낸 뒤, 나머지를
 * 런 52% / 스테이션 48%로 나누고 스테이션은 난이도 가중치로 배분.
 */

export const LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type Level = (typeof LEVELS)[number];

const ROXZONE_BUDGET_MS: Record<Level, number> = {
  beginner: 7 * 60_000,
  intermediate: 5.5 * 60_000,
  advanced: 4 * 60_000,
};

const RUN_SHARE = 0.52;

export type PredictResult = {
  runLapMs: number; // 1km당
  runTotalMs: number;
  stations: { key: string; nameKo: string; targetMs: number }[];
  stationTotalMs: number;
  roxzoneTotalMs: number;
  roxzoneEachMs: number; // 8회 평균
};

export type AchievabilityTier =
  | "aggressive"
  | "challenging"
  | "realistic"
  | "comfortable";

/**
 * 목표 시간의 현실성 티어 (S14).
 * 공개 결과 분포 기반 벤치마크(S13)가 준비되기 전의 근사치 —
 * 레벨별 통상 완주 시간대(분)를 기준으로 목표가 어디에 위치하는지 판정한다.
 * 정밀 확률(%)을 지어내지 않고 정성적 티어로만 안내한다.
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

export function predictSplits(
  targetTotalMs: number,
  level: Level,
): PredictResult | null {
  const roxzoneTotalMs = ROXZONE_BUDGET_MS[level];
  const remaining = targetTotalMs - roxzoneTotalMs;
  if (remaining <= 0) return null;

  const runTotalMs = Math.round(remaining * RUN_SHARE);
  const stationTotalMs = remaining - runTotalMs;
  const weightSum = STATIONS.reduce((acc, s) => acc + s.weight, 0);

  return {
    runLapMs: Math.round(runTotalMs / 8),
    runTotalMs,
    stations: STATIONS.map((s) => ({
      key: s.key,
      nameKo: s.nameKo,
      targetMs: Math.round((stationTotalMs * s.weight) / weightSum),
    })),
    stationTotalMs,
    roxzoneTotalMs,
    roxzoneEachMs: Math.round(roxzoneTotalMs / 8),
  };
}
