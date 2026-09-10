import { STATIONS } from "@/lib/hyrox";

/**
 * 랜딩 미리보기용 **가짜 기록**.
 *
 * 실제 사용자 데이터를 절대 쓰지 않는다 — 랜딩은 비로그인 화면이고, 특정
 * 개인의 기록을 마케팅 화면에 박아두면 그 사람의 기록이 공개돼 버린다.
 * 요청마다 새로 만들되 하이록스답게 보이는 범위 안에서만 흔든다.
 * 서버에서 만들어 props 로 내려주므로 하이드레이션 불일치는 없다.
 */

const rnd = (min: number, max: number) => min + Math.random() * (max - min);
const ri = (min: number, max: number) => Math.round(rnd(min, max));

/** 미리보기에 쓰는 스테이션 6종 (8종을 다 그리면 모바일에서 넘친다) */
const COMPARE_KEYS = ["ski", "sledpush", "sledpull", "burpee", "row", "wallballs"];

export type Round = { run: number; rox: number; station: string; stationSec: number };

export type HistoryRow = {
  day: string;
  year: string;
  kind: "race" | "sim";
  division: string;
  time: number;
  /** 개인 최고 대비 초. null 이면 그 기록이 개인 최고 */
  delta: number | null;
};

export type LandingDemo = {
  rounds: Round[];
  runTotal: number;
  stationTotal: number;
  roxTotal: number;
  finish: number;
  /** 런 랩 편차(초) */
  lapSpread: number;
  slowest: { key: string; sec: number };
  percentile: number;
  pbDelta: number;
  history: HistoryRow[];
  compare: { key: string; sim: number; race: number }[];
};

export function makeLandingDemo(): LandingDemo {
  // 런 8랩 — 후반으로 갈수록 조금씩 느려지는 게 보통이다
  const base = rnd(250, 300);
  const rounds: Round[] = STATIONS.map((s, i) => ({
    run: Math.round(base * (1 + (i / 7) * rnd(0.08, 0.3)) * rnd(0.96, 1.06)),
    // 마지막 라운드 뒤에는 록스존이 없다
    rox: i === 7 ? 0 : ri(62, 130),
    station: s.key,
    stationSec: Math.round(s.weight * rnd(22, 40)),
  }));

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const runTotal = sum(rounds.map((r) => r.run));
  const roxTotal = sum(rounds.map((r) => r.rox));
  const stationTotal = sum(rounds.map((r) => r.stationSec));
  const finish = runTotal + roxTotal + stationTotal;

  const laps = rounds.map((r) => r.run);
  const lapSpread = Math.max(...laps) - Math.min(...laps);

  const slowest = rounds
    .map((r) => ({ key: r.station, sec: r.stationSec }))
    .sort((a, b) => b.sec - a.sec)[0];

  // 히스토리 — 최근 것부터. 마지막(가장 오래된) 행이 개인 최고가 되도록 만든다.
  const best = Math.round(finish * rnd(0.76, 0.86));
  const divisions = ["OPEN", "PRO", "DOUBLES", "RELAY"];
  const now = new Date();
  const history: HistoryRow[] = [0, 1, 2, 3].map((i) => {
    const d = new Date(now);
    d.setMonth(d.getMonth() - (i * 3 + 1));
    const isBest = i === 3;
    const time = isBest ? best : Math.round(best * rnd(1.01, 1.28));
    return {
      day: `${d.getMonth() + 1}/${d.getDate()}`,
      year: String(d.getFullYear()),
      kind: i % 2 === 0 ? "race" : "sim",
      division: divisions[i % divisions.length],
      time,
      delta: isBest ? null : time - best,
    };
  });

  // 훈련(시뮬) × 레이스 — 같은 구간을 나란히
  const half = (from: number, to: number) =>
    sum(rounds.slice(from, to).map((r) => r.run));
  const compare = [
    { key: "run14", race: half(0, 4) },
    { key: "run58", race: half(4, 8) },
    ...COMPARE_KEYS.map((k) => ({
      key: k,
      race: rounds.find((r) => r.station === k)!.stationSec,
    })),
  ].map((row) => ({ ...row, sim: Math.round(row.race * rnd(0.9, 1.16)) }));

  return {
    rounds,
    runTotal,
    stationTotal,
    roxTotal,
    finish,
    lapSpread,
    slowest,
    percentile: ri(12, 48),
    pbDelta: finish - best,
    history,
    compare,
  };
}
