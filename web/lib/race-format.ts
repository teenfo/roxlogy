import type { DictKey } from "@/lib/i18n/dictionaries/en";
import { PFT_COLORS, PFT_STATIONS } from "@/lib/pft";
import { CHART_COLORS, SIM_STATION_COLORS, STATIONS } from "@/lib/hyrox";

/**
 * 레이스 계측 종목 — 한 레이스가 몇 구간을 어떤 순서로 찍는지 (마이그레이션 114).
 *
 * PFT 레이스와 하이록스 시뮬 레이스는 코드·웨이브·DNF·스태프 계측·라이브보드를 같이 쓰고
 * **구간 목록만 다르다**. 화면은 PFT_STATIONS 를 직접 읽지 말고 여기서 목록을 받는다.
 *
 * 하이록스 시뮬 체크포인트 모드 (8 랩 반복) — DB `_race_sim_session` 과 같아야 한다:
 *   16 = run, station                    — 록스존은 다음 런에 포함
 *   24 = run, roxzone, station           — 웹 수동 입력·가민과 같은 구조
 *   32 = run, roxzone, station, roxzone  — Wear OS 레코더와 같은 구조
 */

export type RaceFormat = "pft" | "hyrox_sim";
export type SimCheckpoints = 16 | 24 | 32;
export const SIM_CHECKPOINTS: SimCheckpoints[] = [16, 24, 32];

export type CheckpointKind = "pft" | "run" | "roxzone" | "station";

export type Checkpoint = {
  /** 목록 안에서 유일한 키 (React key) */
  key: string;
  kind: CheckpointKind;
  /** 1~8 랩 (PFT 는 종목 순서 1~6) */
  lap: number;
  /** 32 모드 록스존의 입/출 구분 */
  roxSide?: "in" | "out";
  /** PFT 종목 키 또는 하이록스 스테이션 키 */
  stationKey?: string;
  color: string;
};

type TFn = (key: DictKey, params?: Record<string, string | number>) => string;

const SIM_PATTERN: Record<SimCheckpoints, CheckpointKind[]> = {
  16: ["run", "station"],
  24: ["run", "roxzone", "station"],
  32: ["run", "roxzone", "station", "roxzone"],
};

/** 레이스 한 판의 구간 목록. 알 수 없는 조합이면 PFT 로 본다(옛 응답엔 format 이 없다). */
export function checkpointsFor(format: RaceFormat | null | undefined, n: number | null | undefined): Checkpoint[] {
  if (format === "hyrox_sim" && (n === 16 || n === 24 || n === 32)) {
    const pattern = SIM_PATTERN[n];
    const out: Checkpoint[] = [];
    for (let lap = 1; lap <= 8; lap++) {
      let rox = 0;
      for (const kind of pattern) {
        if (kind === "roxzone") rox += 1;
        const st = STATIONS[lap - 1];
        out.push({
          key: `${kind}-${lap}-${out.length}`,
          kind,
          lap,
          roxSide: kind === "roxzone" && n === 32 ? (rox === 1 ? "in" : "out") : undefined,
          stationKey: kind === "station" ? st.key : undefined,
          // 스테이션은 종목마다 다른 색(SIM_STATION_COLORS), 런·록스존은 공통 색
          color:
            kind === "run"
              ? CHART_COLORS.run
              : kind === "station"
                ? (SIM_STATION_COLORS[st.key] ?? CHART_COLORS.station)
                : CHART_COLORS.roxzone,
        });
      }
    }
    return out;
  }
  return PFT_STATIONS.map((st, i) => ({
    key: st.key,
    kind: "pft" as const,
    lap: i + 1,
    stationKey: st.key,
    color: PFT_COLORS[st.key],
  }));
}

/** 구간 이름 — "런 3", "록스존 3 입", "슬레드 푸시 50m", PFT 는 종목 이름 */
export function checkpointLabel(t: TFn, cp: Checkpoint): string {
  if (cp.kind === "pft") {
    const st = PFT_STATIONS.find((s) => s.key === cp.stationKey);
    return st ? t(st.label) : cp.key;
  }
  if (cp.kind === "run") return t("race.cp.run", { n: cp.lap });
  if (cp.kind === "roxzone") {
    if (cp.roxSide === "in") return t("race.cp.roxIn", { n: cp.lap });
    if (cp.roxSide === "out") return t("race.cp.roxOut", { n: cp.lap });
    return t("race.cp.roxzone", { n: cp.lap });
  }
  return t(`station.${cp.stationKey}` as DictKey);
}

/** 목록·칩에 붙이는 종목 이름 — "PFT" / "하이록스 시뮬 16" */
export function formatLabel(t: TFn, format: RaceFormat | null | undefined, n: number | null | undefined): string {
  return format === "hyrox_sim" ? t("race.fmt.simN", { n: n ?? 16 }) : t("race.fmt.pft");
}

/**
 * 종목별 경로 — 하이록스 시뮬은 PFT 와 메뉴를 나눠 /timing 아래에 둔다(2026-09-29).
 * 레이스 한 판의 화면(선수·스태프)은 같은 페이지를 쓰고 주소만 다르다. 옛 주소
 * /pft/race/<코드> 도 그대로 열린다.
 */
export function raceBase(format: RaceFormat | string | null | undefined): string {
  return format === "hyrox_sim" ? "/timing" : "/pft/race";
}

/** 종목별 허브(뒤로 가기) — PFT 허브 또는 타임체크 목록 */
export function raceHome(format: RaceFormat | string | null | undefined): string {
  return format === "hyrox_sim" ? "/timing" : "/pft";
}
