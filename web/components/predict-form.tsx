"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatMs, parseTimeToMs } from "@/lib/format";
import { STATIONS } from "@/lib/hyrox";
import { DIVISIONS } from "@/lib/divisions";
import {
  achievabilityTier,
  predictSplits,
  LEVELS,
  type Level,
} from "@/lib/predict";
import { InfoTip } from "@/components/info-tip";
import { useI18n } from "@/components/i18n-provider";

const TIER_STYLE: Record<string, string> = {
  aggressive: "border-red-400/60 text-red-400",
  challenging: "border-accent/60 text-accent",
  realistic: "border-track/60 text-track",
  comfortable: "border-muted/60 text-muted",
};

export type PredictSession = {
  id: string;
  label: string;
  total: number;
  stations: Record<string, number>;
  runTotalMs: number;
  roxTotalMs: number;
};

type Adjust = {
  stations: Record<string, string>;
  run: string;
  rox: string;
};

const STATION_KEYS = STATIONS.map((s) => s.key);

export function PredictForm({
  isLoggedIn = false,
  sessions = [],
  eventName = null,
  eventDate = null,
  initialDivision = null,
}: {
  isLoggedIn?: boolean;
  sessions?: PredictSession[];
  eventName?: string | null;
  eventDate?: string | null;
  initialDivision?: string | null;
}) {
  const { t } = useI18n();
  const [targetText, setTargetText] = useState("1:30:00");
  const [level, setLevel] = useState<Level>("intermediate");
  const [division, setDivision] = useState<string>(initialDivision ?? "");
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

  // 조정 패널 상태 (로그인 시). null이면 아직 미개시 → 제안값으로 시드.
  const [adj, setAdj] = useState<Adjust | null>(null);
  const [pickedSession, setPickedSession] = useState<string>("");

  function seedFromResult(): Adjust | null {
    if (!result) return null;
    const stations: Record<string, string> = {};
    result.stations.forEach((s) => (stations[s.key] = formatMs(s.targetMs)));
    return {
      stations,
      run: formatMs(result.runTotalMs),
      rox: formatMs(result.roxzoneTotalMs),
    };
  }

  function loadSession(id: string) {
    setPickedSession(id);
    setSaveState("idle");
    const s = sessions.find((x) => x.id === id);
    if (!s) return;
    const stations: Record<string, string> = {};
    STATION_KEYS.forEach(
      (k) => (stations[k] = formatMs(s.stations[k] ?? 0)),
    );
    setAdj({
      stations,
      run: formatMs(s.runTotalMs),
      rox: formatMs(s.roxTotalMs),
    });
  }

  // 화면에 쓸 조정값 (미시드면 제안값)
  const eff = adj ?? seedFromResult();

  const adjustedMs = useMemo(() => {
    if (!eff) return null;
    const st = STATION_KEYS.reduce(
      (acc, k) => acc + (parseTimeToMs(eff.stations[k] ?? "") ?? 0),
      0,
    );
    const run = parseTimeToMs(eff.run) ?? 0;
    const rox = parseTimeToMs(eff.rox) ?? 0;
    return st + run + rox;
  }, [eff]);

  function setStation(key: string, value: string) {
    setSaveState("idle");
    setAdj((prev) => {
      const base = prev ?? seedFromResult();
      if (!base) return prev;
      return { ...base, stations: { ...base.stations, [key]: value } };
    });
  }
  function setField(field: "run" | "rox", value: string) {
    setSaveState("idle");
    setAdj((prev) => {
      const base = prev ?? seedFromResult();
      if (!base) return prev;
      return { ...base, [field]: value };
    });
  }

  async function saveGoal() {
    if (!eff || adjustedMs == null) return;
    setSaveState("saving");
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaveState("idle");
      return;
    }
    const stationsMs = STATION_KEYS.map((k) => ({
      key: k,
      targetMs: parseTimeToMs(eff.stations[k] ?? "") ?? 0,
    }));
    const stationTotal = stationsMs.reduce((a, s) => a + s.targetMs, 0);
    await supabase.from("goal_plans").insert({
      user_id: user.id,
      target_total_ms: adjustedMs,
      level,
      division: division || null,
      event_name: eventName,
      event_date: eventDate,
      run_total_ms: parseTimeToMs(eff.run) ?? 0,
      station_total_ms: stationTotal,
      roxzone_total_ms: parseTimeToMs(eff.rox) ?? 0,
      stations: stationsMs,
    });
    setSaveState("saved");
  }

  const inputCls =
    "w-24 rounded-md border border-muted/30 bg-surface px-2 py-1.5 text-right font-mono text-sm text-foreground outline-none focus:border-accent";

  return (
    <main>
      <h1 className="text-2xl font-bold">{t("predict.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("predict.desc")}</p>

      {eventName && (
        <div className="mt-4 rounded-md border border-accent/40 bg-accent/10 px-4 py-3">
          <p className="text-xs text-muted">{t("predict.forEvent")}</p>
          <p className="mt-0.5 text-sm font-semibold text-accent">
            {eventName}
            {eventDate ? ` · ${eventDate}` : ""}
          </p>
        </div>
      )}

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
              <p className="text-xs text-muted">
                {t("predict.roxzoneBudget")}
                <InfoTip text={t("predict.roxzoneInfo")} />
              </p>
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

          {isLoggedIn && eff ? (
            <section className="mt-8 rounded-md border border-accent/25 bg-surface/50 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold">
                    {t("predict.adjustTitle")}
                  </h2>
                  <p className="mt-0.5 text-xs text-muted">
                    {t("predict.adjustDesc")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setAdj(seedFromResult());
                    setPickedSession("");
                    setSaveState("idle");
                  }}
                  className="text-xs font-semibold text-accent hover:underline"
                >
                  {t("predict.resetToSuggested")}
                </button>
              </div>

              <div className="mt-4 flex flex-wrap gap-4">
                <label className="flex flex-col gap-1.5 text-sm text-muted">
                  {t("newSession.division")}
                  <select
                    value={division}
                    onChange={(e) => {
                      setDivision(e.target.value);
                      setSaveState("idle");
                    }}
                    className="rounded-md border border-muted/30 bg-surface px-3 py-2 text-foreground outline-none focus:border-accent"
                  >
                    <option value="">{t("newSession.divisionNone")}</option>
                    {DIVISIONS.map((d) => (
                      <option key={d} value={d}>
                        {t(`division.${d}` as Parameters<typeof t>[0])}
                      </option>
                    ))}
                  </select>
                </label>
                {sessions.length > 0 && (
                  <label className="flex flex-col gap-1.5 text-sm text-muted">
                    {t("predict.fromSession")}
                    <select
                      value={pickedSession}
                      onChange={(e) => loadSession(e.target.value)}
                      className="max-w-sm rounded-md border border-muted/30 bg-surface px-3 py-2 text-foreground outline-none focus:border-accent"
                    >
                      <option value="">{t("predict.fromSessionPh")}</option>
                      {sessions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label} · {formatMs(s.total)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              <div className="mt-4 rounded-md bg-background px-4 py-3">
                <p className="text-xs text-muted">{t("predict.adjustedTotal")}</p>
                <p className="mt-1 font-mono text-2xl font-bold text-accent">
                  {formatMs(adjustedMs)}
                </p>
              </div>

              <div className="mt-4 grid gap-1.5">
                {STATIONS.map((s, i) => (
                  <div
                    key={s.key}
                    className="flex items-center gap-3 rounded-md bg-background px-4 py-2"
                  >
                    <span className="w-6 text-right font-mono text-xs text-muted">
                      {i + 1}
                    </span>
                    <span className="flex-1 text-sm">
                      {t(`station.${s.key}` as Parameters<typeof t>[0])}
                    </span>
                    <input
                      value={eff.stations[s.key] ?? ""}
                      onChange={(e) => setStation(s.key, e.target.value)}
                      inputMode="numeric"
                      className={inputCls}
                    />
                  </div>
                ))}
                <div className="mt-1 flex items-center gap-3 rounded-md bg-background px-4 py-2">
                  <span className="flex-1 text-sm text-track">
                    {t("predict.runTotalField")}
                  </span>
                  <input
                    value={eff.run}
                    onChange={(e) => setField("run", e.target.value)}
                    inputMode="numeric"
                    className={inputCls}
                  />
                </div>
                <div className="flex items-center gap-3 rounded-md bg-background px-4 py-2">
                  <span className="flex-1 text-sm">
                    {t("predict.roxTotalField")}
                  </span>
                  <input
                    value={eff.rox}
                    onChange={(e) => setField("rox", e.target.value)}
                    inputMode="numeric"
                    className={inputCls}
                  />
                </div>
              </div>

              <div className="mt-5 flex items-center gap-3">
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
            </section>
          ) : !isLoggedIn ? (
            <p className="mt-6 rounded-md border border-track/30 bg-surface px-4 py-3 text-sm text-muted">
              <Link href="/signup" className="text-accent hover:underline">
                {t("predict.signupPrompt.before")}
              </Link>
              {t("predict.signupPrompt.after")}
            </p>
          ) : null}
        </>
      )}
    </main>
  );
}
