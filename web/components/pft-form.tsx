"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { formatMs, formatTimeInput, parseTimeToMs } from "@/lib/format";
import {
  PFT_STATIONS,
  badgeDictKey,
  badgeScale,
  cutoffsFor,
  pftBadge,
  toNextBadge,
  type PftResult,
} from "@/lib/pft";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Chip, Choice, Field, Hint, Panel } from "@/components/rox/ui";

/**
 * PFT 기록 입력·수정 — 시안 racing.tsx 의 PFT(new/edit) 그대로 (PORT_PLAN §3-d):
 * form.rx-form-layout[ Panel "측정 결과"(.rx-form-grid Field·.rx-check·Hint) | aside Panel
 * "입력 확인"(.rx-summary-time · 배지 · 저장) ]. 구간 스플릿·측정 정보는 시안보다 많은 우리
 * 입력이라 같은 열에 Panel 을 더 쌓는다(§4-1).
 *
 * 총 시간만 있으면 저장되고 구간 스플릿은 선택이다. 나이·성별은 배지 판정과 리더보드
 * 분류에 쓰이므로 저장 시점 값으로 고정한다(프로필에서 미리 채워 넣되, 여기서 덮어쓸 수 있다).
 */
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
  const preview = totalMs != null ? pftBadge(totalMs, ageNum, scaled) : null;

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

  const splitStatus =
    filled === 0
      ? t("pft.splitOptional")
      : splitOver
        ? `${t("pft.splitSum", { sum: formatMs(splitSum) })} — ${t("pft.errSplitSum")}`
        : splitMatch
          ? `${t("pft.splitSum", { sum: formatMs(splitSum) })} ✓`
          : t("pft.splitPartial", { n: filled, total: PFT_STATIONS.length, sum: formatMs(splitSum) });

  return (
    <form onSubmit={save} className="rx-form-layout">
      <div>
        <Panel title={t("pft.fResult")}>
          <div className="rx-form-grid">
            <Field label={t("pft.fDate")}>
              <Input
                type="date"
                value={testedOn}
                onChange={(e) => setTestedOn(e.target.value)}
                required
              />
            </Field>
            <Field label={`${t("pft.fTotal")} *`}>
              <Input
                value={total}
                onChange={(e) => setTotal(formatTimeInput(e.target.value))}
                placeholder="mm:ss"
                inputMode="numeric"
                required
              />
            </Field>
          </div>
          {total && totalMs == null && (
            <p className="rx-error">{t("pft.errTotal")}</p>
          )}
          {tooShort && <p className="rx-error">{t("pft.errTooShort")}</p>}
        </Panel>

        <Panel
          title={t("pft.fSplits")}
          action={
            <Chip tone={splitOver ? "red" : splitMatch ? "green" : "neutral"}>{splitStatus}</Chip>
          }
        >
          <div className="rx-form-grid">
            {PFT_STATIONS.map((st, i) => (
              <Field key={st.key} label={`${i + 1}. ${t(st.label)}`}>
                <Input
                  value={splits[st.key] ?? ""}
                  onChange={(e) =>
                    setSplits((p) => ({ ...p, [st.key]: formatTimeInput(e.target.value) }))
                  }
                  placeholder="4:30"
                  inputMode="numeric"
                />
              </Field>
            ))}
          </div>
        </Panel>

        <Panel title={t("pft.fInfo")}>
          <div className="rx-form-grid">
            <Field label={t("pft.fAge")}>
              <Input
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="35"
                inputMode="numeric"
              />
            </Field>
            <Field label={t("pft.fGender")}>
              <Choice
                label={t("pft.fGender")}
                value={gender || "none"}
                onChange={(v) => setGender(v === "none" ? "" : v)}
                options={[
                  ["none", "—"],
                  ["male", t("pft.male")],
                  ["female", t("pft.female")],
                  ["other", t("pft.other")],
                ]}
              />
            </Field>
            <Field label={t("pft.fLocation")}>
              <Input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                maxLength={80}
                placeholder={t("pft.fLocationPh")}
              />
            </Field>
            <Field label={t("pft.fNote")}>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
            </Field>
          </div>
          <Hint>{t("pft.ageHint")}</Hint>
          <label className="rx-check">
            <Checkbox checked={scaled} onCheckedChange={(v) => setScaled(v === true)} />
            {t("pft.fScaled")}
          </label>
          <Hint>{t("pft.fScaledHint")}</Hint>
          <label className="rx-check">
            <Checkbox checked={shared} onCheckedChange={(v) => setShared(v === true)} />
            {t("pft.fShared")}
          </label>
        </Panel>
      </div>

      {/* 입력 확인 — 입력하는 동안 배지가 어떻게 바뀌는지 옆에서 보인다 */}
      <aside>
        <Panel title={t("pft.entryCheck")}>
          <div className="rx-summary-time">{totalMs != null ? formatMs(totalMs) : "—:—"}</div>
          <p>
            {preview ? (
              <>
                <Chip tone="yellow">{t(badgeDictKey(preview))}</Chip>
                {next && (
                  <>
                    {" "}
                    {t("pft.toNext", { badge: t(badgeDictKey(next.next)), gap: formatMs(next.gapMs) })}
                  </>
                )}
              </>
            ) : (
              t("pft.previewBadge")
            )}
          </p>
          <Hint>
            {ageNum != null && ageNum >= 45 ? t("pft.o45") : t("pft.u45")} ·{" "}
            {badgeScale(t, cuts, formatMs)}
            {ageNum == null && ` · ${t("pft.noAgeHint")}`}
          </Hint>
          {err && (
            <p role="alert" className="rx-error">
              {err}
            </p>
          )}
          <Button className="rx-primary rx-wide" type="submit" disabled={busy || !canSave}>
            {busy ? t("common.saving") : t("common.save")}
          </Button>
          <Hint>
            {totalMs == null
              ? t("pft.hintNeedTotal")
              : tooShort
                ? t("pft.errTooShort")
                : splitOver
                  ? t("pft.errSplitSum")
                  : shared
                    ? t("pft.hintShared")
                    : t("pft.hintPrivate")}
          </Hint>
        </Panel>
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
    <>
      <Button variant="ghost" size="sm" type="button" onClick={del} disabled={busy}>
        {t("common.delete")}
      </Button>
      {err && <span className="rx-error">{err}</span>}
    </>
  );
}
