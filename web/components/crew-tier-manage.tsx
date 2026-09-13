"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { TIER_COLORS, tierBadgeClass, type TierColor } from "@/lib/crew-role";
import { duesErrText } from "@/lib/dues-error";

export type CrewTier = {
  id: string;
  name: string;
  sort_order: number;
  color: string;
  is_full_member: boolean;
  monthly_fee: number | null;
  session_fee: number | null;
  is_default: boolean;
  archived_at: string | null;
};

const input =
  "w-full rounded-md border border-muted/30 bg-background px-3 py-2 text-sm outline-none focus:border-accent";

function toFee(v: string): number | null {
  const n = parseInt(v.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 회원 등급 관리 — 운영진 전용. **여기서는 등급만 다룬다**: 이름·색·정회원 권한·기본
 *  등급·삭제. 등급이 요금표를 겸하지만 금액은 회비 탭(CrewTierFees)에서 정한다 —
 *  회비 설정이 두 탭에 흩어져 있어 어디서 고치는지 헷갈렸다(2026-09-14 피드백).
 *  삭제는 쓰는 사람이 있으면 보관 처리된다(delete_crew_tier RPC 가 판단). */
export function CrewTierManage({
  crewId,
  tiers,
}: {
  crewId: string;
  tiers: CrewTier[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<TierColor>("gray");
  const [isFull, setIsFull] = useState(false);

  async function run(key: string, fn: () => PromiseLike<{ error: unknown }>) {
    setBusy(key);
    setErr(null);
    const { error } = await fn();
    setBusy(null);
    if (error)
      setErr(
        duesErrText(t, (error as { message?: string }).message ?? String(error)),
      );
    else router.refresh();
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const supabase = createClient();
    await run("add", () =>
      supabase.from("crew_member_tiers").insert({
        crew_id: crewId,
        name: name.trim(),
        color,
        is_full_member: isFull,
        // 금액은 비워 두고 만든다 — 요금은 회비 탭에서 정한다
        sort_order: (tiers.at(-1)?.sort_order ?? 0) + 1,
      }),
    );
    setName("");
    setIsFull(false);
    setColor("gray");
    setAdding(false);
  }

  const patch = (id: string, values: Record<string, unknown>) =>
    run(id, () =>
      createClient().from("crew_member_tiers").update(values).eq("id", id),
    );

  async function remove(tier: CrewTier) {
    if (!window.confirm(t("crew.tierDeleteConfirm", { name: tier.name }))) return;
    setBusy(tier.id);
    setErr(null);
    const { data, error } = await createClient().rpc("delete_crew_tier", {
      p_tier: tier.id,
    });
    setBusy(null);
    if (error) return setErr(duesErrText(t, error.message));
    if (data === "archived") window.alert(t("crew.tierArchived", { name: tier.name }));
    router.refresh();
  }

  // 기본 등급은 하나뿐이라 단일 인덱스가 강제한다 — 먼저 내리고 올린다.
  async function makeDefault(tier: CrewTier) {
    const cur = tiers.find((x) => x.is_default);
    setBusy(tier.id);
    setErr(null);
    const supabase = createClient();
    if (cur && cur.id !== tier.id) {
      const { error } = await supabase
        .from("crew_member_tiers")
        .update({ is_default: false })
        .eq("id", cur.id);
      if (error) {
        setBusy(null);
        return setErr(duesErrText(t, error.message));
      }
    }
    const { error } = await supabase
      .from("crew_member_tiers")
      .update({ is_default: true })
      .eq("id", tier.id);
    setBusy(null);
    if (error) setErr(duesErrText(t, error.message));
    else router.refresh();
  }

  const active = tiers.filter((x) => !x.archived_at);
  const archived = tiers.filter((x) => x.archived_at);

  return (
    <div>
      <p className="text-xs text-muted">{t("crew.tierDesc")}</p>
      {err && <p role="alert" className="mt-2 text-sm text-red-400">{err}</p>}

      <ul className="mt-3 flex flex-col gap-1.5">
        {active.map((x) => (
          <li key={x.id} className="rounded-md bg-surface px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${tierBadgeClass(x.color)}`}
              >
                {x.name}
              </span>
              {x.is_default && (
                <span className="text-[10px] font-semibold text-accent">
                  {t("crew.tierDefault")}
                </span>
              )}
              {x.is_full_member && (
                <span className="text-[10px] text-muted">{t("crew.tierFull")}</span>
              )}
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
              <div className="flex gap-1">
                {TIER_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={c}
                    disabled={busy != null}
                    onClick={() => patch(x.id, { color: c })}
                    className={`h-5 w-5 rounded-full ${tierBadgeClass(c)} ${
                      x.color === c ? "ring-2" : ""
                    }`}
                  />
                ))}
              </div>
              <label className="flex items-center gap-1.5 text-muted">
                <input
                  type="checkbox"
                  checked={x.is_full_member}
                  disabled={busy != null}
                  onChange={(e) => patch(x.id, { is_full_member: e.target.checked })}
                />
                {t("crew.tierFull")}
              </label>
              {!x.is_default && (
                <button
                  type="button"
                  disabled={busy != null}
                  onClick={() => makeDefault(x)}
                  className="text-accent hover:underline disabled:opacity-50"
                >
                  {t("crew.tierMakeDefault")}
                </button>
              )}
              {!x.is_default && (
                <button
                  type="button"
                  disabled={busy != null}
                  onClick={() => remove(x)}
                  className="ml-auto text-red-400 hover:underline disabled:opacity-50"
                >
                  {t("crew.tierDelete")}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {archived.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          {t("crew.tierArchivedList")}: {archived.map((x) => x.name).join(", ")}
        </p>
      )}

      {adding ? (
        <form onSubmit={add} className="mt-3 rounded-md bg-surface px-4 py-3">
          <input
            className={input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("crew.tierNamePh")}
            maxLength={20}
            autoFocus
          />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <div className="flex gap-1">
              {TIER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  onClick={() => setColor(c)}
                  className={`h-5 w-5 rounded-full ${tierBadgeClass(c)} ${
                    color === c ? "ring-2" : ""
                  }`}
                />
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-muted">
              <input
                type="checkbox"
                checked={isFull}
                onChange={(e) => setIsFull(e.target.checked)}
              />
              {t("crew.tierFull")}
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              disabled={busy != null || !name.trim()}
              className="rounded-md bg-accent px-4 py-1.5 text-xs font-bold text-background disabled:opacity-40"
            >
              {t("crew.tierAdd")}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="text-xs text-muted"
            >
              {t("common.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-3 rounded-md bg-surface px-4 py-2 text-sm font-semibold hover:text-accent"
        >
          + {t("crew.tierAdd")}
        </button>
      )}
    </div>
  );
}

/** 등급별 요금 — 회비 탭. 등급이 곧 요금표라 등급마다 월회비·회차비를 여기서 정한다.
 *  등급의 이름·색·권한은 등급 탭이 맡는다 — 두 화면이 같은 행을 고치던 것을 갈랐다
 *  (2026-09-14 피드백).
 *
 *  칸을 벗어날 때(onBlur) 저장한다. 숫자를 지우면 null 이 되어 "요금 없음"이고,
 *  월회비가 없는 등급은 일괄 청구에서 빠진다. */
export function CrewTierFees({
  crewId,
  tiers,
}: {
  crewId: string;
  tiers: CrewTier[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function patch(id: string, values: Record<string, unknown>) {
    setBusy(id);
    setErr(null);
    const { error } = await createClient()
      .from("crew_member_tiers")
      .update(values)
      .eq("id", id)
      .eq("crew_id", crewId);
    setBusy(null);
    if (error) return setErr(duesErrText(t, error.message));
    setSaved(id);
    window.setTimeout(() => setSaved((p) => (p === id ? null : p)), 1500);
    router.refresh();
  }

  const active = tiers.filter((x) => !x.archived_at);
  const feeInput =
    "w-28 rounded-md border border-muted/30 bg-background px-2 py-1.5 text-right text-sm tabular outline-none focus:border-accent disabled:opacity-50";

  if (!active.length) {
    return <p className="text-xs text-muted">{t("crew.tierFeeNone")}</p>;
  }

  return (
    <div>
      {err && (
        <p role="alert" className="mb-2 text-sm text-red-400">
          {err}
        </p>
      )}
      <ul className="flex flex-col gap-1.5">
        {active.map((x) => (
          <li
            key={x.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-surface px-4 py-3"
          >
            <span
              className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${tierBadgeClass(x.color)}`}
            >
              {x.name}
            </span>
            {x.is_default && (
              <span className="text-[10px] font-semibold text-accent">
                {t("crew.tierDefault")}
              </span>
            )}
            {saved === x.id && (
              <span className="text-[10px] font-semibold text-success">
                {t("common.saved")}
              </span>
            )}
            <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
              <label className="flex items-center gap-1.5 text-xs text-muted">
                {t("crew.tierMonthly")}
                <input
                  className={feeInput}
                  defaultValue={x.monthly_fee ?? ""}
                  placeholder="—"
                  inputMode="numeric"
                  disabled={busy != null}
                  onBlur={(e) => {
                    const v = toFee(e.target.value);
                    if (v !== x.monthly_fee) void patch(x.id, { monthly_fee: v });
                  }}
                />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-muted">
                {t("crew.tierSession")}
                <input
                  className={feeInput}
                  defaultValue={x.session_fee ?? ""}
                  placeholder="—"
                  inputMode="numeric"
                  disabled={busy != null}
                  onBlur={(e) => {
                    const v = toFee(e.target.value);
                    if (v !== x.session_fee) void patch(x.id, { session_fee: v });
                  }}
                />
              </label>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">{t("crew.tierFeeHint")}</p>
    </div>
  );
}
