"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Hint, Panel } from "@/components/rox/ui";
import { formatMs, formatTimeInput, parseTimeToMs, todayISOIn } from "@/lib/format";
import {
  RUN_KINDS,
  RUN_SURFACES,
  formatPace,
  riegelTo1kMs,
  type Run,
} from "@/lib/run";

// 시안 .rx-field 와 같은 라벨·select 모양 (Input/Textarea 는 shadcn 프리미티브)
const input = "rx-locale w-full max-w-none";
const label = "mt-4 mb-1.5 block text-sm font-semibold";

/** 러닝 기록 입력·수정. 거리 + 시간만 필수고 페이스는 DB 생성 컬럼이 채운다
 *  (여기 미리보기는 표시용). 1km 환산도 같이 보여줘서 이 기록이 기준선을
 *  갱신하는지 감이 오게 한다. */
export function RunForm({ initial, tz }: { initial?: Run; tz?: string }) {
  const { t } = useI18n();
  const router = useRouter();

  const [ranOn, setRanOn] = useState(initial?.ran_on ?? todayISOIn(tz));
  const [kind, setKind] = useState<string>(initial?.kind ?? "easy");
  const [surface, setSurface] = useState<string>(initial?.surface ?? "treadmill");
  const [distance, setDistance] = useState(
    initial ? String(initial.distance_m) : "",
  );
  const [duration, setDuration] = useState(
    initial ? formatMs(initial.duration_ms) : "",
  );
  const [incline, setIncline] = useState(
    initial?.incline_pct != null ? String(initial.incline_pct) : "",
  );
  const [avgHr, setAvgHr] = useState(
    initial?.avg_hr != null ? String(initial.avg_hr) : "",
  );
  const [maxHr, setMaxHr] = useState(
    initial?.max_hr != null ? String(initial.max_hr) : "",
  );
  const [rpe, setRpe] = useState(initial?.rpe != null ? String(initial.rpe) : "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const distanceM = distance.trim() ? parseInt(distance, 10) : null;
  const durationMs = parseTimeToMs(duration);
  const distanceOk =
    distanceM != null && Number.isFinite(distanceM) &&
    distanceM >= 100 && distanceM <= 200000;
  const paceS =
    distanceOk && durationMs != null ? durationMs / distanceM : null;
  const projected =
    distanceOk && durationMs != null
      ? riegelTo1kMs(distanceM, durationMs)
      : null;

  const num = (v: string) => (v.trim() ? Number(v) : null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!distanceOk) return setErr(t("run.errDistance"));
    if (durationMs == null) return setErr(t("run.errDuration"));
    setBusy(true);
    setErr(null);

    const supabase = createClient();
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      setBusy(false);
      return setErr(t("common.needLogin"));
    }

    const payload = {
      user_id: u.user.id,
      ran_on: ranOn,
      kind,
      surface,
      distance_m: distanceM,
      duration_ms: durationMs,
      incline_pct: num(incline),
      avg_hr: num(avgHr),
      max_hr: num(maxHr),
      rpe: num(rpe),
      location: location.trim() || null,
      note: note.trim() || null,
      client_updated_at: new Date().toISOString(),
    };

    const { error } = initial
      ? await supabase.from("runs").update(payload).eq("id", initial.id)
      : await supabase.from("runs").insert(payload);

    setBusy(false);
    // supabase-js 는 실패해도 throw 하지 않는다 — error 를 반드시 확인한다
    if (error) return setErr(error.message);
    router.push("/runs");
    router.refresh();
  }

  return (
    <form onSubmit={save} className="rx-form-layout">
      <Panel title={t("run.info")}>
      <div>
      <label className={label} htmlFor="run-date">
        {t("run.date")}
      </label>
      <Input
        id="run-date"
        type="date"
        value={ranOn}
        onChange={(e) => setRanOn(e.target.value)}
        required
      />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="run-kind">
            {t("run.kind")}
          </label>
          <select
            id="run-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className={input}
          >
            {RUN_KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {t(k.label)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="run-surface">
            {t("run.surface")}
          </label>
          <select
            id="run-surface"
            value={surface}
            onChange={(e) => setSurface(e.target.value)}
            className={input}
          >
            {RUN_SURFACES.map((s) => (
              <option key={s.key} value={s.key}>
                {t(s.label)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="run-distance">
            {t("run.distance")}
          </label>
          <Input
            id="run-distance"
            inputMode="numeric"
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
            placeholder="5000"
            required
          />
        </div>
        <div>
          <label className={label} htmlFor="run-duration">
            {t("run.duration")}
          </label>
          <Input
            id="run-duration"
            value={duration}
            onChange={(e) => setDuration(formatTimeInput(e.target.value))}
            placeholder="25:00"
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={label} htmlFor="run-incline">
            {t("run.incline")}
          </label>
          <Input
            id="run-incline"
            inputMode="decimal"
            value={incline}
            onChange={(e) => setIncline(e.target.value)}
            placeholder="1"
          />
        </div>
        <div>
          <label className={label} htmlFor="run-avghr">
            {t("run.avgHr")}
          </label>
          <Input
            id="run-avghr"
            inputMode="numeric"
            value={avgHr}
            onChange={(e) => setAvgHr(e.target.value)}
          />
        </div>
        <div>
          <label className={label} htmlFor="run-maxhr">
            {t("run.maxHr")}
          </label>
          <Input
            id="run-maxhr"
            inputMode="numeric"
            value={maxHr}
            onChange={(e) => setMaxHr(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="run-rpe">
            {t("run.rpe")}
          </label>
          <Input
            id="run-rpe"
            inputMode="numeric"
            value={rpe}
            onChange={(e) => setRpe(e.target.value)}
          />
        </div>
        <div>
          <label className={label} htmlFor="run-location">
            {t("run.location")}
          </label>
          <Input
            id="run-location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            maxLength={80}
          />
        </div>
      </div>

      <label className={label} htmlFor="run-note">
        {t("run.note")}
      </label>
      <Textarea
        id="run-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        rows={3}
      />

      {err && (
        <p role="alert" className="rx-error">
          {err}
        </p>
      )}
      </div>
      </Panel>
      <aside>
        {/* 페이스 미리보기 — 저장하면 DB 생성 컬럼이 같은 값을 채운다 */}
        <Panel title={t("run.pace")}>
          <div className="rx-summary-time">{paceS != null ? formatPace(paceS) : "—"}</div>
          <p>
            min / km
            {projected != null ? ` · 1km ≈ ${formatMs(Math.round(projected))}` : ""}
          </p>
          <Hint>{t("run.paceHint")}</Hint>
          <div>
            <Button type="submit" className="rx-primary rx-wide" disabled={busy}>
              {busy ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </Panel>
      </aside>
    </form>
  );
}

/** 러닝 삭제 — soft delete (deleted_at). 기준선 계산에서도 즉시 빠진다. */
export function RunDeleteButton({ id }: { id: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function del() {
    if (!window.confirm(t("run.deleteConfirm"))) return;
    setBusy(true);
    setErr(null);
    const { error } = await createClient()
      .from("runs")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    setBusy(false);
    if (error) setErr(error.message);
    else router.refresh();
  }

  return (
    <span>
      <button
        type="button"
        onClick={del}
        disabled={busy}
        className="text-xs text-muted hover:text-danger disabled:opacity-50"
      >
        {t("common.delete")}
      </button>
      {err && <span className="ml-2 text-xs text-danger">{err}</span>}
    </span>
  );
}
