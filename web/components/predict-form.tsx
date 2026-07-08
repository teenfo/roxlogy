"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatMs, parseTimeToMs } from "@/lib/format";
import {
  achievabilityTier,
  predictSplits,
  LEVELS,
  type Level,
} from "@/lib/predict";
import { useI18n } from "@/components/i18n-provider";

const TIER_STYLE: Record<string, string> = {
  aggressive: "border-red-400/60 text-red-400",
  challenging: "border-accent/60 text-accent",
  realistic: "border-track/60 text-track",
  comfortable: "border-muted/60 text-muted",
};

export function PredictForm({ isLoggedIn = false }: { isLoggedIn?: boolean }) {
  const { t } = useI18n();
  const [targetText, setTargetText] = useState("1:30:00");
  const [level, setLevel] = useState<Level>("intermediate");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );

  const targetMs = useMemo(() => parseTimeToMs(targetText), [targetText]);
  const result = useMemo(
    () => (targetMs != null ? predictSplits(targetMs, level) : null),
    [targetMs, level],
  );
  const tier = useMemo(
    () => (targetMs != null ? achievabilityTier(targetMs, level) : null),
    [targetMs, level],
  );

  async function saveGoal() {
    if (!result || targetMs == null) return;
    setSaveState("saving");
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaveState("idle");
      return;
    }
    await supabase.from("goal_plans").insert({
      user_id: user.id,
      target_total_ms: targetMs,
      level,
      run_total_ms: result.runTotalMs,
      station_total_ms: result.stationTotalMs,
      roxzone_total_ms: result.roxzoneTotalMs,
      stations: result.stations.map((s) => ({ key: s.key, targetMs: s.targetMs })),
    });
    setSaveState("saved");
  }

  return (
    <main>
      <h1 className="text-2xl font-bold">{t("predict.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("predict.desc")}</p>

      <div className="mt-6 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          {t("predict.target")}
          <input
            value={targetText}
            onChange={(e) => setTargetText(e.target.value)}
            inputMode="numeric"
            className="w-36 rounded-md border border-muted/30 bg-surface px-3 py-2.5 font-mono text-lg text-foreground outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          {t("predict.level")}
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as Level)}
            className="rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-foreground outline-none focus:border-accent"
          >
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {t(`predict.level.${l}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!result ? (
        <p className="mt-8 rounded-md bg-surface px-4 py-8 text-center text-sm text-muted">
          {t("predict.invalid")}
        </p>
      ) : (
        <>
          {tier && (
            <div className="mt-6 flex items-center gap-3">
              <span
                className={`rounded-full border px-3 py-1 text-sm font-semibold ${TIER_STYLE[tier]}`}
              >
                {t(`predict.tier.${tier}`)}
              </span>
              <span className="text-xs text-muted">
                {t(`predict.tierNote.${tier}`)}
              </span>
            </div>
          )}

          <section className="mt-6 grid grid-cols-3 gap-3">
            <div className="rounded-md bg-surface px-4 py-3">
              <p className="text-xs text-muted">{t("predict.runPerKm")}</p>
              <p className="mt-1 font-mono text-xl font-bold text-track">
                {formatMs(result.runLapMs)}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {t("predict.runSum", { time: formatMs(result.runTotalMs) })}
              </p>
            </div>
            <div className="rounded-md bg-surface px-4 py-3">
              <p className="text-xs text-muted">{t("predict.stationSum")}</p>
              <p className="mt-1 font-mono text-xl font-bold text-accent">
                {formatMs(result.stationTotalMs)}
              </p>
            </div>
            <div className="rounded-md bg-surface px-4 py-3">
              <p className="text-xs text-muted">{t("predict.roxzoneBudget")}</p>
              <p className="mt-1 font-mono text-xl font-bold">
                {formatMs(result.roxzoneTotalMs)}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {t("predict.roxzoneEach", {
                  time: formatMs(result.roxzoneEachMs),
                })}
              </p>
            </div>
          </section>

          <section className="mt-6">
            <h2 className="text-lg font-semibold">
              {t("predict.stationTargets")}
            </h2>
            <ol className="mt-3 flex flex-col gap-1.5">
              {result.stations.map((s, i) => (
                <li
                  key={s.key}
                  className="flex items-center gap-3 rounded-md bg-surface px-4 py-2.5"
                >
                  <span className="w-6 text-right font-mono text-xs text-muted">
                    {i + 1}
                  </span>
                  <span className="flex-1 text-sm">
                    {t(`station.${s.key}` as Parameters<typeof t>[0])}
                  </span>
                  <span className="font-mono text-sm font-semibold">
                    {formatMs(s.targetMs)}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          {isLoggedIn ? (
            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={saveGoal}
                disabled={saveState !== "idle"}
                className="rounded-md bg-accent px-5 py-2.5 text-sm font-bold text-background hover:brightness-110 disabled:opacity-50"
              >
                {saveState === "saving"
                  ? t("common.saving")
                  : saveState === "saved"
                    ? t("predict.saved")
                    : t("predict.saveGoal")}
              </button>
              {saveState === "saved" && (
                <Link
                  href="/dashboard"
                  className="text-sm text-accent hover:underline"
                >
                  {t("predict.viewRehearsal")}
                </Link>
              )}
            </div>
          ) : (
            <p className="mt-6 rounded-md border border-track/30 bg-surface px-4 py-3 text-sm text-muted">
              <Link href="/signup" className="text-accent hover:underline">
                {t("predict.signupPrompt.before")}
              </Link>
              {t("predict.signupPrompt.after")}
            </p>
          )}
        </>
      )}
    </main>
  );
}
