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

/** 회원 등급 관리 — 운영진 전용. 등급이 곧 요금표라, 월회비·회차비를 여기서 정한다.
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
  const [monthly, setMonthly] = useState("");
  const [session, setSession] = useState("");

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
        monthly_fee: toFee(monthly),
        session_fee: toFee(session),
        sort_order: (tiers.at(-1)?.sort_order ?? 0) + 1,
      }),
    );
    setName("");
    setMonthly("");
    setSession("");
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
  const fee = (n: number | null) => (n == null ? "—" : `₩${n.toLocaleString("ko-KR")}`);

  return (
    <div>
      <p className="text-xs text-muted">{t("crew.tierDesc")}</p>
      {err && <p className="mt-2 text-sm text-red-400">{err}</p>}

      <ul className="mt-3 flex flex-col gap-1.5">
        {active.map((x) => (
          <li key={x.id} className="rounded-md bg-surface px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${tierBadgeClass(x.color)}`}
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
              <span className="ml-auto font-mono text-xs text-muted">
                {t("crew.tierMonthly")} {fee(x.monthly_fee)} · {t("crew.tierSession")}{" "}
                {fee(x.session_fee)}
              </span>
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
              <input
                className="w-24 rounded-md border border-muted/30 bg-background px-2 py-1 text-xs"
                defaultValue={x.monthly_fee ?? ""}
                placeholder={t("crew.tierMonthly")}
                inputMode="numeric"
                onBlur={(e) => {
                  const v = toFee(e.target.value);
                  if (v !== x.monthly_fee) patch(x.id, { monthly_fee: v });
                }}
              />
              <input
                className="w-24 rounded-md border border-muted/30 bg-background px-2 py-1 text-xs"
                defaultValue={x.session_fee ?? ""}
                placeholder={t("crew.tierSession")}
                inputMode="numeric"
                onBlur={(e) => {
                  const v = toFee(e.target.value);
                  if (v !== x.session_fee) patch(x.id, { session_fee: v });
                }}
              />
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
            <input
              className="w-24 rounded-md border border-muted/30 bg-background px-2 py-1 text-xs"
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
              placeholder={t("crew.tierMonthly")}
              inputMode="numeric"
            />
            <input
              className="w-24 rounded-md border border-muted/30 bg-background px-2 py-1 text-xs"
              value={session}
              onChange={(e) => setSession(e.target.value)}
              placeholder={t("crew.tierSession")}
              inputMode="numeric"
            />
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
