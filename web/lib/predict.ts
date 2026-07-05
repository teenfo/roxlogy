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
