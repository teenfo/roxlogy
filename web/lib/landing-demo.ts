import { STATIONS } from "@/lib/hyrox";

/**
 * 랜딩 히어로 카드에 쓰는 **가짜 기록**.
 *
 * 실제 사용자 데이터를 절대 쓰지 않는다 — 랜딩은 비로그인 화면이고, 특정
 * 개인의 기록을 마케팅 화면에 박아두면 그 사람 기록이 공개돼 버린다.
 * 요청마다 새로 만들되 하이록스답게 보이는 범위 안에서만 흔든다.
 * 서버에서 만들어 props 로 내려주므로 하이드레이션 불일치는 없다.
 */

const rnd = (min: number, max: number) => min + Math.random() * (max - min);
const ri = (min: number, max: number) => Math.round(rnd(min, max));
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];

export type LandingDemo = {
  division: string;
  runTotal: number;
  stationTotal: number;
  roxTotal: number;
  finish: number;
  /** 가장 오래 걸린 스테이션 */
  slowest: { key: string; sec: number };
  percentile: number;
  /** 기록 날짜 (ISO). 화면 표시는 서버에서 로케일에 맞춰 포맷한다 */
  racedOn: string;
};

export function makeLandingDemo(): LandingDemo {
  // 런 8랩 — 후반으로 갈수록 조금씩 느려지는 게 보통이다
  const base = rnd(250, 300);
  const runs = Array.from({ length: 8 }, (_, i) =>
    Math.round(base * (1 + (i / 7) * rnd(0.08, 0.3)) * rnd(0.96, 1.06)),
  );
  // 마지막 라운드 뒤에는 록스존이 없다
  const rox = Array.from({ length: 8 }, (_, i) => (i === 7 ? 0 : ri(62, 130)));
  const stations = STATIONS.map((s) => ({
    key: s.key,
    sec: Math.round(s.weight * rnd(22, 40)),
  }));

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const runTotal = sum(runs);
  const roxTotal = sum(rox);
  const stationTotal = sum(stations.map((s) => s.sec));

  const raced = new Date();
  raced.setDate(raced.getDate() - ri(20, 200));

  return {
    division: pick(["OPEN", "PRO", "PRO DOUBLES", "RELAY"]),
    runTotal,
    stationTotal,
    roxTotal,
    finish: runTotal + roxTotal + stationTotal,
    slowest: [...stations].sort((a, b) => b.sec - a.sec)[0],
    percentile: ri(12, 48),
    racedOn: raced.toISOString(),
  };
}
