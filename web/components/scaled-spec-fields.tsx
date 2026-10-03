"use client";

import { useI18n } from "@/components/i18n-provider";
import { SIM_SCALE_FIELDS } from "@/lib/race-format";
import { SIM_STATION_COLORS } from "@/lib/hyrox";
import type { DictKey } from "@/lib/i18n/dictionaries/en";

export type ScaledInputs = Record<string, { amount: string; weight: string }>;

const cell =
  "h-10 w-full min-w-0 rounded-lg border border-line-strong bg-page px-2.5 text-sm tabular outline-none focus:border-accent";

/**
 * 시뮬 레이스의 scaled 기준 입력 — 8 종목 × (거리·횟수, 무게). 바꾼 칸만 채운다(마이그레이션 135).
 * 레이스 만들기 폼과 스태프 화면의 레이스 수정 패널이 같이 쓴다.
 */
export function ScaledSpecFields({ value, onChange }: { value: ScaledInputs; onChange: (v: ScaledInputs) => void }) {
  const { t } = useI18n();
  const set = (key: string, field: "amount" | "weight", v: string) =>
    onChange({ ...value, [key]: { ...(value[key] ?? { amount: "", weight: "" }), [field]: v } });
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-xs text-muted">{t("race.scale.heading")}</legend>
      <p className="text-xs text-muted">{t("race.scale.hint")}</p>
      {/* 칸 폭(19rem)에 맞춰 열 수가 정해진다 — 좁은 생성 폼은 1열, 넓은 수정 패널은 2~3열 */}
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(19rem,100%),1fr))]">
        {SIM_SCALE_FIELDS.map((f) => {
          const v = value[f.key] ?? { amount: "", weight: "" };
          return (
            <div key={f.key} className="flex items-center gap-2 rounded-xl border border-line-soft bg-inset px-3 py-2">
              <span aria-hidden className="h-6 w-1.5 shrink-0 rounded-full" style={{ background: SIM_STATION_COLORS[f.key] }} />
              <span className="min-w-[6.5rem] flex-1 truncate text-sm font-bold">{t(`race.scale.st.${f.key}` as DictKey)}</span>
              <label className="w-20 shrink-0">
                <span className="sr-only">
                  {t(`race.scale.st.${f.key}` as DictKey)} {t(f.unit === "reps" ? "race.scale.reps" : "race.scale.distance")}
                </span>
                <input
                  className={cell}
                  inputMode="numeric"
                  value={v.amount}
                  onChange={(e) => set(f.key, "amount", e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder={f.unit === "reps" ? t("race.scale.repsN", { n: f.std }) : `${f.std}m`}
                />
              </label>
              {f.weighted ? (
                <label className="w-16 shrink-0">
                  <span className="sr-only">
                    {t(`race.scale.st.${f.key}` as DictKey)} {t("race.scale.weight")}
                  </span>
                  <input
                    className={cell}
                    inputMode="decimal"
                    value={v.weight}
                    onChange={(e) => set(f.key, "weight", e.target.value.replace(/[^0-9.]/g, ""))}
                    placeholder="kg"
                  />
                </label>
              ) : (
                <span className="w-16 shrink-0" aria-hidden />
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
