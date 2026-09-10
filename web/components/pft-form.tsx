"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { formatMs, parseTimeToMs } from "@/lib/format";
import {
  PFT_STATIONS,
  badgeClass,
  badgeDictKey,
  cutoffsFor,
  pftBadge,
  toNextBadge,
  type PftResult,
} from "@/lib/pft";

const input =
  "h-10 w-full rounded-lg border border-line-strong bg-page px-3 text-sm outline-none focus:border-accent";
const label = "mt-3 block text-xs text-muted";
const card = "rounded-2xl border border-line bg-card px-5 py-4";

/** PFT 기록 입력·수정. 총 시간만 있으면 저장되고 구간 스플릿은 선택이다.
 *  나이·성별은 배지 판정과 리더보드 분류에 쓰이므로 저장 시점 값으로 고정한다
 *  (프로필에서 미리 채워 넣되, 여기서 덮어쓸 수 있다). */
export function PftForm({
  initial,
  defaultAge,
  defaultGender,
}: {
  initial?: PftResult;
  defaultAge: number | null;
  defaultGender: string | null;
}) {
  const { t } = useI18n();
  const router = useRouter();

  const asTime = (ms: number | null | undefined) => (ms == null ? "" : formatMs(ms));
  const [testedOn, setTestedOn] = useState(
    initial?.tested_on ?? new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }),
  );
  const [total, setTotal] = useState(asTime(initial?.total_ms));
  const [splits, setSplits] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const s of PFT_STATIONS) o[s.key] = asTime(initial?.[s.col]);
    return o;
  });
  const [age, setAge] = useState(String(initial?.age ?? defaultAge ?? ""));
  const [gender, setGender] = useState(initial?.gender ?? defaultGender ?? "");
  const [scaled, setScaled] = useState(initial?.scaled ?? false);
  const [location, setLocation] = useState(initial?.location ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [shared, setShared] = useState(initial?.shared ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const totalMs = parseTimeToMs(total);
  const ageNum = age.trim() ? parseInt(age, 10) : null;
  const splitMs = PFT_STATIONS.map((s) => parseTimeToMs(splits[s.key] ?? ""));
  const splitSum = splitMs.reduce<number>((a, v) => a + (v ?? 0), 0);
  // PFT 는 구간 사이에 쉬지 않으므로 스플릿 합이 총 시간을 넘을 수 없다.
  const splitOver = totalMs != null && splitSum > totalMs;
  const preview =
    totalMs != null ? pftBadge(totalMs, ageNum, scaled) : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (totalMs == null) return setErr(t("pft.errTotal"));
    if (splitOver) return setErr(t("pft.errSplitSum"));
    setBusy(true);
    setErr(null);

    const supabase = createClient();
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      setBusy(false);
      return setErr(t("common.needLogin"));
    }
    const payload: Record<string, unknown> = {
      user_id: u.user.id,
      tested_on: testedOn,
      total_ms: totalMs,
      age: ageNum,
      gender: gender || null,
      scaled,
      location: location.trim() || null,
      note: note.trim() || null,
      shared,
    };
    PFT_STATIONS.forEach((s, i) => {
      payload[s.col] = splitMs[i];
    });

    const { error } = initial
      ? await supabase.from("pft_results").update(payload).eq("id", initial.id)
      : await supabase.from("pft_results").insert(payload);
    setBusy(false);
    if (error) return setErr(error.message);
    router.push("/pft");
    router.refresh();
  }

  const cuts = cutoffsFor(ageNum);
  const next = totalMs != null ? toNextBadge(totalMs, ageNum, scaled) : null;
  const filled = PFT_STATIONS.filter((st) => splitMs[PFT_STATIONS.indexOf(st)] != null).length;
  const tooShort = totalMs != null && totalMs < 300_000;
  // 구간 합계가 총 시간과 ±2초 안이면 일치로 본다 (수동 입력 반올림 오차)
  const splitMatch =
    filled === PFT_STATIONS.length && totalMs != null
      ? Math.abs(splitSum - totalMs) <= 2000
      : null;
  const canSave = totalMs != null && !tooShort && !splitOver;

  return (
    <form onSubmit={save} className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex flex-col gap-3.5">
        {/* 결과 */}
        <section className={card}>
          <h2 className="text-[15px] font-extrabold">{t("pft.fResult")}</h2>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs text-muted">{t("pft.fDate")}</span>
              <input
                type="date"
                className={`${input} mt-1 [color-scheme:dark]`}
                value={testedOn}
                onChange={(e) => setTestedOn(e.target.value)}
                required
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted">{t("pft.fTotal")} *</span>
              <input
                className={`${input} tabular mt-1 h-[42px] text-lg font-bold`}
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                placeholder="mm:ss"
                inputMode="numeric"
                required
              />
            </label>
          </div>
          {total && totalMs == null && (
            <p className="mt-1.5 text-xs text-danger">{t("pft.errTotal")}</p>
          )}
          {tooShort && (
            <p className="mt-1.5 text-xs text-danger">{t("pft.errTooShort")}</p>
          )}
        </section>

        {/* 구간 기록 */}
        <section className={card}>
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-[15px] font-extrabold">{t("pft.fSplits")}</h2>
            <span
              className={`ml-auto text-xs ${
                splitOver
                  ? "text-danger"
                  : splitMatch
                    ? "text-success"
                    : "text-muted"
              }`}
            >
              {filled === 0
                ? t("pft.splitOptional")
                : splitOver
                  ? `${t("pft.splitSum", { sum: formatMs(splitSum) })} — ${t("pft.errSplitSum")}`
                  : splitMatch
                    ? `${t("pft.splitSum", { sum: formatMs(splitSum) })} ✓`
                    : t("pft.splitPartial", {
                        n: filled,
                        total: PFT_STATIONS.length,
                        sum: formatMs(splitSum),
                      })}
            </span>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {PFT_STATIONS.map((st, i) => (
              <label key={st.key} className="block">
                <span className="flex items-center gap-1.5 text-[11px] text-muted">
                  <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-line text-[10px] font-bold">
                    {i + 1}
                  </span>
                  {t(st.label)}
                </span>
                <input
                  className={`${input} tabular mt-1`}
                  value={splits[st.key] ?? ""}
                  onChange={(e) =>
                    setSplits((p) => ({ ...p, [st.key]: e.target.value }))
                  }
                  placeholder="4:30"
                  inputMode="numeric"
                />
              </label>
            ))}
          </div>
        </section>

        {/* 측정 정보 */}
        <section className={card}>
          <h2 className="text-[15px] font-extrabold">{t("pft.fInfo")}</h2>
          <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_1fr_2fr]">
            <label className="block">
              <span className="text-xs text-muted">{t("pft.fAge")}</span>
              <input
                className={`${input} tabular mt-1`}
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="35"
                inputMode="numeric"
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted">{t("pft.fGender")}</span>
              <select
                className={`${input} mt-1`}
                value={gender}
                onChange={(e) => setGender(e.target.value)}
              >
                <option value="">—</option>
                <option value="male">{t("pft.male")}</option>
                <option value="female">{t("pft.female")}</option>
                <option value="other">{t("pft.other")}</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-muted">{t("pft.fLocation")}</span>
              <input
                className={`${input} mt-1`}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                maxLength={80}
                placeholder={t("pft.fLocationPh")}
              />
            </label>
          </div>
          <p className="mt-1.5 text-[11px] text-muted">{t("pft.ageHint")}</p>

          <label className={label}>{t("pft.fNote")}</label>
          <textarea
            className={`${input} min-h-20 py-2`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
          />

          <div className="mt-3 flex flex-col gap-2.5 border-t border-line pt-3">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1 accent-accent"
                checked={scaled}
                onChange={(e) => setScaled(e.target.checked)}
              />
              <span>
                {t("pft.fScaled")}
                <span className="mt-0.5 block text-[11px] text-muted">
                  {t("pft.fScaledHint")}
                </span>
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-accent"
                checked={shared}
                onChange={(e) => setShared(e.target.checked)}
              />
              {t("pft.fShared")}
            </label>
          </div>
        </section>
      </div>

      {/* 미리보기 — 입력하는 동안 배지가 어떻게 바뀌는지 옆에서 보인다 */}
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <div
          className={`rounded-2xl border px-5 py-4 ${
            preview ? "border-line-accent bg-highlight" : "border-line bg-card"
          }`}
        >
          <p className="text-[11px] font-extrabold tracking-[0.08em] text-muted">
            {t("pft.previewBadge")}
          </p>
          <p
            className={`tabular mt-1 text-[40px] font-extrabold leading-none ${totalMs != null ? "text-accent" : "text-[#444]"}`}
          >
            {totalMs != null ? formatMs(totalMs) : "--:--"}
          </p>
          {preview && (
            <p className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className={`rounded-md px-2.5 py-1 text-xs font-extrabold ${badgeClass(preview)}`}
              >
                {t(badgeDictKey(preview))}
              </span>
              {next && (
                <span className="text-xs text-muted">
                  {t("pft.toNext", {
                    badge: t(badgeDictKey(next.next)),
                    gap: formatMs(next.gapMs),
                  })}
                </span>
              )}
            </p>
          )}
          <p className="tabular mt-2 text-[11px] text-muted">
            {ageNum != null && ageNum >= 45 ? t("pft.o45") : t("pft.u45")} ·{" "}
            {t("pft.badge.gold")} &lt;{formatMs(cuts.gold)} ·{" "}
            {t("pft.badge.silver")} &lt;{formatMs(cuts.silver)}
          </p>
          {ageNum == null && (
            <p className="mt-1 text-[11px] text-muted">{t("pft.noAgeHint")}</p>
          )}

          {err && <p className="mt-3 text-sm text-danger">{err}</p>}

          <button
            type="submit"
            disabled={busy || !canSave}
            className={`mt-4 h-11 w-full rounded-lg text-[15px] font-extrabold ${
              canSave
                ? "bg-accent text-background hover:brightness-110"
                : "cursor-not-allowed bg-[#2a2a2a] text-[#666]"
            } disabled:opacity-60`}
          >
            {busy ? t("common.saving") : t("common.save")}
          </button>
          <p className="mt-2 text-center text-[11px] text-muted">
            {totalMs == null
              ? t("pft.hintNeedTotal")
              : tooShort
                ? t("pft.errTooShort")
                : splitOver
                  ? t("pft.errSplitSum")
                  : shared
                    ? t("pft.hintShared")
                    : t("pft.hintPrivate")}
          </p>
        </div>
      </aside>
    </form>
  );
}

/** 기록 삭제 — soft delete (deleted_at). 리더보드에서도 즉시 빠진다. */
export function PftDeleteButton({ id }: { id: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function del() {
    if (!window.confirm(t("pft.deleteConfirm"))) return;
    setBusy(true);
    setErr(null);
    const { error } = await createClient()
      .from("pft_results")
      .update({ deleted_at: new Date().toISOString(), shared: false })
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
        className="text-xs text-muted hover:text-red-400 disabled:opacity-50"
      >
        {t("common.delete")}
      </button>
      {err && <span className="ml-2 text-xs text-red-400">{err}</span>}
    </span>
  );
}
