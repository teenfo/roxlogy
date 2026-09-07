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
  pftBadge,
  type PftResult,
} from "@/lib/pft";

const input =
  "w-full rounded-md border border-muted/30 bg-background px-3 py-2 text-sm outline-none focus:border-accent";
const label = "mt-4 block text-xs text-muted";

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

  return (
    <form onSubmit={save} className="max-w-lg">
      <label className={label}>{t("pft.fDate")}</label>
      <input
        type="date"
        className={input}
        value={testedOn}
        onChange={(e) => setTestedOn(e.target.value)}
        required
      />

      <label className={label}>{t("pft.fTotal")}</label>
      <input
        className={input}
        value={total}
        onChange={(e) => setTotal(e.target.value)}
        placeholder="24:30"
        inputMode="numeric"
        required
      />
      {total && totalMs == null && (
        <p className="mt-1 text-xs text-red-400">{t("pft.errTotal")}</p>
      )}

      {/* 배지 미리보기 — 저장 시 DB 가 같은 규칙으로 다시 판정한다 */}
      {preview && (
        <p className="mt-2 flex items-center gap-2 text-xs text-muted">
          {t("pft.previewBadge")}
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${badgeClass(preview)}`}
          >
            {t(badgeDictKey(preview))}
          </span>
          {ageNum == null && (
            <span className="text-[11px]">{t("pft.noAgeHint")}</span>
          )}
        </p>
      )}

      <p className={label}>{t("pft.fSplits")}</p>
      <div className="mt-1 grid grid-cols-2 gap-2">
        {PFT_STATIONS.map((s) => (
          <label key={s.key} className="flex flex-col gap-1">
            <span className="text-[11px] text-muted">{t(s.label)}</span>
            <input
              className={input}
              value={splits[s.key] ?? ""}
              onChange={(e) =>
                setSplits((p) => ({ ...p, [s.key]: e.target.value }))
              }
              placeholder="4:30"
              inputMode="numeric"
            />
          </label>
        ))}
      </div>
      {splitSum > 0 && (
        <p className={`mt-1.5 text-xs ${splitOver ? "text-red-400" : "text-muted"}`}>
          {t("pft.splitSum", { sum: formatMs(splitSum) })}
          {splitOver && ` — ${t("pft.errSplitSum")}`}
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <span className="block text-xs text-muted">{t("pft.fAge")}</span>
          <input
            className={`${input} mt-1`}
            value={age}
            onChange={(e) => setAge(e.target.value)}
            placeholder="35"
            inputMode="numeric"
          />
        </div>
        <div>
          <span className="block text-xs text-muted">{t("pft.fGender")}</span>
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
        </div>
      </div>
      <p className="mt-1 text-[11px] text-muted">{t("pft.ageHint")}</p>

      <label className={label}>{t("pft.fLocation")}</label>
      <input
        className={input}
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        maxLength={80}
        placeholder={t("pft.fLocationPh")}
      />

      <label className={label}>{t("pft.fNote")}</label>
      <textarea
        className={`${input} min-h-20`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
      />

      <label className="mt-4 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
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

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={shared}
          onChange={(e) => setShared(e.target.checked)}
        />
        {t("pft.fShared")}
      </label>

      {err && <p className="mt-3 text-sm text-red-400">{err}</p>}

      <button
        type="submit"
        disabled={busy || totalMs == null}
        className="mt-5 rounded-md bg-accent px-5 py-2.5 text-sm font-bold text-background hover:brightness-110 disabled:opacity-40"
      >
        {busy ? "…" : t("common.save")}
      </button>
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
