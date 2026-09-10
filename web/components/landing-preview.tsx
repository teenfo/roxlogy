"use client";

import { useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { CHART_COLORS } from "@/lib/hyrox";
import { formatMs } from "@/lib/format";
import type { LandingDemo } from "@/lib/landing-demo";
import type { DictKey } from "@/lib/i18n/dictionaries/en";

const TABS = ["session", "history", "compare"] as const;
type Tab = (typeof TABS)[number];

const sec = (s: number) => formatMs(s * 1000);
const signed = (s: number) => `${s >= 0 ? "+" : "−"}${sec(Math.abs(s))}`;

/**
 * 랜딩의 "분석 화면 미리보기" — 브라우저 프레임 안에서 탭 3개를 전환한다.
 * 숫자는 전부 lib/landing-demo.ts 가 만든 가짜 데이터다 (실사용자 기록 아님).
 */
export function LandingPreview({ demo }: { demo: LandingDemo }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("session");

  const maxRound = Math.max(
    ...demo.rounds.map((r) => r.run + r.rox + r.stationSec),
  );

  return (
    <div className="flex flex-col gap-6">
      {/* 헤더 + 탭 */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-extrabold tracking-[0.1em] text-accent">
            SESSION ANALYSIS
          </p>
          <h2 className="mt-1.5 text-[32px] font-extrabold tracking-tight [word-break:keep-all] max-md:text-[26px]">
            {t("landing.previewTitle")}
          </h2>
          <p className="mt-1.5 text-[15px] text-muted [word-break:keep-all]">
            {t("landing.previewSub")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {TABS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`flex h-[34px] items-center rounded-full px-3.5 text-[13px] font-semibold transition-colors ${
                tab === k
                  ? "bg-accent text-background"
                  : "border border-line-strong text-muted hover:text-foreground"
              }`}
            >
              {t(`landing.tab.${k}` as DictKey)}
            </button>
          ))}
        </div>
      </div>

      {/* 브라우저 프레임 */}
      <div className="overflow-hidden rounded-2xl border border-line-mid bg-card shadow-[0_30px_80px_rgba(0,0,0,.6)]">
        <div className="flex h-10 items-center gap-2.5 border-b border-line bg-page px-4">
          <span aria-hidden className="flex gap-1.5">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-2.5 w-2.5 rounded-full bg-line-strong" />
            ))}
          </span>
          <span className="ml-1 min-w-0 flex-1 truncate rounded-full bg-control px-3 py-1 text-[11px] text-muted">
            roxlogy.com/sessions/…
          </span>
          <span className="shrink-0 rounded-[5px] bg-label-bg px-2 py-[3px] text-[10px] font-bold text-label">
            {t("landing.sampleData")}
          </span>
        </div>

        <div className="p-[22px] max-md:p-3.5">
          {tab === "session" && <SessionTab demo={demo} maxRound={maxRound} />}
          {tab === "history" && <HistoryTab demo={demo} />}
          {tab === "compare" && <CompareTab demo={demo} />}
        </div>
      </div>
    </div>
  );
}

function SessionTab({
  demo,
  maxRound,
}: {
  demo: LandingDemo;
  maxRound: number;
}) {
  const { t } = useI18n();
  const metrics = [
    { label: t("landing.m.run"), value: sec(demo.runTotal), color: CHART_COLORS.run },
    {
      label: t("landing.m.station"),
      value: sec(demo.stationTotal),
      color: CHART_COLORS.station,
    },
    {
      label: t("landing.m.roxzone"),
      value: sec(demo.roxTotal),
      color: CHART_COLORS.roxzone,
    },
    {
      label: t("landing.m.spread"),
      value: `±${sec(demo.lapSpread)}`,
      color: "var(--danger)",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* 히어로 — 기록과 개인 최고 대비 */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-line-accent bg-highlight px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-[5px] bg-accent/15 px-2 py-[3px] text-[11px] font-bold text-accent-dim">
              {t("landing.demoRace")}
            </span>
            <span className="rounded-[5px] bg-label-bg px-2 py-[3px] text-[11px] font-bold text-label">
              {demo.history[0].division}
            </span>
          </div>
          <p className="mt-1.5 text-xl font-extrabold">
            {t("landing.demoRaceName")}
          </p>
        </div>
        <div className="text-right">
          <p className="tabular text-[36px] font-extrabold leading-none text-accent max-md:text-[28px]">
            {sec(demo.finish)}
          </p>
          <p className="mt-1 text-xs text-danger">
            PB {signed(demo.pbDelta)}
          </p>
        </div>
      </div>

      {/* 지표 4칸 */}
      <div className="grid grid-cols-4 gap-2.5 max-md:grid-cols-2">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="rounded-[10px] border border-line bg-page px-3.5 py-3"
          >
            <p className="flex items-center gap-1.5 text-[11px] text-muted">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: m.color }}
              />
              {m.label}
            </p>
            <p className="tabular mt-1 text-[17px] font-extrabold">{m.value}</p>
          </div>
        ))}
      </div>

      {/* 라운드별 스플릿 — 런 / 록스존 / 스테이션 스택 */}
      <div className="rounded-[10px] border border-line bg-page px-3.5 py-3.5">
        <p className="text-[11px] text-muted">{t("landing.splitTitle")}</p>
        <div className="mt-3 flex h-[120px] items-end gap-1.5">
          {demo.rounds.map((r, i) => {
            const parts = [
              { v: r.run, c: CHART_COLORS.run },
              { v: r.rox, c: CHART_COLORS.roxzone },
              { v: r.stationSec, c: CHART_COLORS.station },
            ];
            return (
              <div key={i} className="flex min-w-0 flex-1 flex-col justify-end gap-px">
                {parts.map((p, j) => (
                  <span
                    key={j}
                    className="block w-full rounded-[2px]"
                    style={{
                      height: `${(p.v / maxRound) * 120}px`,
                      background: p.c,
                    }}
                  />
                ))}
              </div>
            );
          })}
        </div>
        <div className="mt-1.5 flex gap-1.5">
          {demo.rounds.map((_, i) => (
            <span
              key={i}
              className="min-w-0 flex-1 text-center text-[10px] text-muted"
            >
              R{i + 1}
            </span>
          ))}
        </div>
      </div>

      {/* AI 코칭 */}
      <div className="rounded-[10px] border border-line bg-page border-l-[3px] border-l-accent px-4 py-3.5">
        <p className="text-[11px] font-extrabold tracking-[0.08em] text-accent">
          {t("landing.aiLabel")}
        </p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/80">
          {t("landing.aiBody", {
            station: t(`station.${demo.slowest.key}` as DictKey),
            sec: sec(demo.slowest.sec),
            rox: sec(demo.roxTotal),
          })}
        </p>
      </div>
    </div>
  );
}

function HistoryTab({ demo }: { demo: LandingDemo }) {
  const { t } = useI18n();
  return (
    <ul className="flex flex-col gap-2">
      {demo.history.map((h, i) => {
        const best = h.delta === null;
        return (
          <li
            key={i}
            className={`grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-3.5 rounded-[10px] border px-4 py-3 max-md:grid-cols-[56px_minmax(0,1fr)] ${
              best
                ? "border-line-accent bg-highlight"
                : "border-line bg-page"
            }`}
          >
            <div className="shrink-0 text-center">
              <p className="tabular text-[15px] font-extrabold leading-none">
                {h.day}
              </p>
              <p className="mt-0.5 text-[10px] text-muted">{h.year}</p>
            </div>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-bold">
                  {h.kind === "race"
                    ? t("landing.demoRaceName")
                    : t("landing.demoSimName")}
                </span>
                <span className="shrink-0 rounded-[5px] bg-label-bg px-1.5 py-[2px] text-[10px] font-bold text-label">
                  {h.division}
                </span>
              </p>
              <p className="mt-0.5 text-[11px] text-muted max-md:mt-1">
                <span className="tabular md:hidden">{sec(h.time)} · </span>
                {best ? t("landing.pbNote") : t("landing.vsPb", { d: signed(h.delta!) })}
              </p>
            </div>
            <p
              className={`tabular shrink-0 text-right text-[17px] font-extrabold max-md:hidden ${
                best ? "text-accent" : ""
              }`}
            >
              {sec(h.time)}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function CompareTab({ demo }: { demo: LandingDemo }) {
  const { t } = useI18n();
  const max = Math.max(...demo.compare.flatMap((c) => [c.sim, c.race]));
  const label = (k: string) =>
    k === "run14"
      ? t("landing.run14")
      : k === "run58"
        ? t("landing.run58")
        : t(`station.${k}` as DictKey);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-4 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-full bg-line-strong" />
          {t("landing.legendSim")}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-full bg-accent" />
          {t("landing.legendRace")}
        </span>
      </div>

      <ul className="flex flex-col gap-2.5">
        {demo.compare.map((c) => {
          const delta = c.race - c.sim;
          return (
            <li
              key={c.key}
              className="grid grid-cols-[100px_minmax(0,1fr)_62px] items-center gap-3 max-sm:grid-cols-[84px_minmax(0,1fr)_56px]"
            >
              <span className="truncate text-[12px] text-muted">
                {label(c.key)}
              </span>
              <span className="flex flex-col gap-1">
                <span
                  className="block h-2 rounded-full bg-line-strong"
                  style={{ width: `${(c.sim / max) * 100}%` }}
                />
                <span
                  className="block h-2 rounded-full bg-accent"
                  style={{ width: `${(c.race / max) * 100}%` }}
                />
              </span>
              <span
                className={`tabular text-right text-[12px] font-bold ${
                  delta <= 0 ? "text-success" : "text-danger"
                }`}
              >
                {signed(delta)}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-muted">{t("landing.compareNote")}</p>
    </div>
  );
}
