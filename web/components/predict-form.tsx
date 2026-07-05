"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatMs, parseTimeToMs } from "@/lib/format";
import { LEVEL_LABEL, predictSplits, type Level } from "@/lib/predict";

export function PredictForm() {
  const [targetText, setTargetText] = useState("1:30:00");
  const [level, setLevel] = useState<Level>("intermediate");

  const result = useMemo(() => {
    const ms = parseTimeToMs(targetText);
    return ms != null ? predictSplits(ms, level) : null;
  }, [targetText, level]);

  return (
    <main>
      <h1 className="text-2xl font-bold">목표 스플릿 계산기</h1>
      <p className="mt-1 text-sm text-muted">
        목표 완주 시간을 입력하면 런 8회·스테이션 8개·트랜지션의 목표
        스플릿을 역산합니다. 공개 레이스 데이터의 통상 분포를 참고한
        근사치입니다.
      </p>

      <div className="mt-6 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          목표 시간 (h:mm:ss)
          <input
            value={targetText}
            onChange={(e) => setTargetText(e.target.value)}
            inputMode="numeric"
            className="w-36 rounded-md border border-muted/30 bg-surface px-3 py-2.5 font-mono text-lg text-foreground outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          레벨
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as Level)}
            className="rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-foreground outline-none focus:border-accent"
          >
            {(Object.keys(LEVEL_LABEL) as Level[]).map((l) => (
              <option key={l} value={l}>
                {LEVEL_LABEL[l]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!result ? (
        <p className="mt-8 rounded-md bg-surface px-4 py-8 text-center text-sm text-muted">
          유효한 목표 시간을 입력하세요. 트랜지션 예산보다 짧은 목표는 계산할
          수 없습니다.
        </p>
      ) : (
        <>
          <section className="mt-8 grid grid-cols-3 gap-3">
            <div className="rounded-md bg-surface px-4 py-3">
              <p className="text-xs text-muted">런 1km당</p>
              <p className="mt-1 font-mono text-xl font-bold text-track">
                {formatMs(result.runLapMs)}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                합계 {formatMs(result.runTotalMs)}
              </p>
            </div>
            <div className="rounded-md bg-surface px-4 py-3">
              <p className="text-xs text-muted">스테이션 합계</p>
              <p className="mt-1 font-mono text-xl font-bold text-accent">
                {formatMs(result.stationTotalMs)}
              </p>
            </div>
            <div className="rounded-md bg-surface px-4 py-3">
              <p className="text-xs text-muted">트랜지션 예산 (8회)</p>
              <p className="mt-1 font-mono text-xl font-bold">
                {formatMs(result.roxzoneTotalMs)}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                회당 ~{formatMs(result.roxzoneEachMs)}
              </p>
            </div>
          </section>

          <section className="mt-6">
            <h2 className="text-lg font-semibold">스테이션별 목표</h2>
            <ol className="mt-3 flex flex-col gap-1.5">
              {result.stations.map((s, i) => (
                <li
                  key={s.key}
                  className="flex items-center gap-3 rounded-md bg-surface px-4 py-2.5"
                >
                  <span className="w-6 text-right font-mono text-xs text-muted">
                    {i + 1}
                  </span>
                  <span className="flex-1 text-sm">{s.nameKo}</span>
                  <span className="font-mono text-sm font-semibold">
                    {formatMs(s.targetMs)}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <p className="mt-6 rounded-md border border-track/30 bg-surface px-4 py-3 text-sm text-muted">
            <Link href="/signup" className="text-accent hover:underline">
              계정을 만들면
            </Link>{" "}
            훈련 세션을 기록하고 이 목표와 실측을 비교할 수 있습니다.
          </p>
        </>
      )}
    </main>
  );
}
