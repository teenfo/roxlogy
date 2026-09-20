"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { TIER_COLORS, tierBarColor, tierChipTone, type TierColor } from "@/lib/crew-role";
import { duesErrText } from "@/lib/dues-error";
import { won } from "@/lib/won";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Chip, Choice, DataTable, Field, Hint, Panel } from "@/components/rox/ui";

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

/** 등급별 활동 회원 수 — tier_id → 명 */
export type TierCounts = Record<string, number>;

function toFee(v: string): number | null {
  const n = parseInt(v.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 변경분만 모아 저장하는 편집 상태. 원본과 다른 행만 update 한다. */
function useDraft<T extends Record<string, unknown>>(tiers: CrewTier[], pick: (x: CrewTier) => T) {
  const [draft, setDraft] = useState<Record<string, T>>({});
  const valueOf = (x: CrewTier): T => draft[x.id] ?? pick(x);
  const set = (id: string, patch: Partial<T>, base: CrewTier) =>
    setDraft((p) => ({ ...p, [id]: { ...(p[id] ?? pick(base)), ...patch } }));
  const changed = (list: CrewTier[]) =>
    list.filter((x) => {
      const d = draft[x.id];
      if (!d) return false;
      const o = pick(x);
      return (Object.keys(o) as (keyof T)[]).some((k) => d[k] !== o[k]);
    });
  return { valueOf, set, changed, reset: () => setDraft({}) };
}

/**
 * 회원 등급 · 회비 — 시안 crew.tsx Manage(회비 기준) 그대로 (PORT_PLAN §3-e):
 * Panel "회원 등급별 회비"[ DataTable[등급 · 월 회비(Input) · 회차비(Input) …] · Hint · 버튼 ].
 * 등급 이름·색·정회원 권한·기본 등급·삭제·인원은 우리 열이라 같은 표에 더한다(§4).
 * 이름·색·권한·금액은 로컬로 모았다가 "저장"으로 한 번에 쓴다.
 */
export function CrewTierManage({ crewId, tiers, counts = {} }: { crewId: string; tiers: CrewTier[]; counts?: TierCounts }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<TierColor>("gray");

  const active = tiers.filter((x) => !x.archived_at);
  const archived = tiers.filter((x) => x.archived_at);
  const d = useDraft(tiers, (x) => ({
    name: x.name,
    color: x.color,
    is_full_member: x.is_full_member,
    monthly: x.monthly_fee == null ? "" : String(x.monthly_fee),
    session: x.session_fee == null ? "" : String(x.session_fee),
  }));
  const dirty = d.changed(active);

  // 이번 달 예상 월 회비 청구 = Σ(월회비 × 그 등급 활동 인원). 저장 전 값으로 미리 센다.
  const expected = active.reduce((a, x) => a + (toFee(d.valueOf(x).monthly) ?? 0) * (counts[x.id] ?? 0), 0);
  const billable = active.reduce((a, x) => a + (toFee(d.valueOf(x).monthly) != null ? (counts[x.id] ?? 0) : 0), 0);

  async function save() {
    setBusy("save");
    setErr(null);
    const supabase = createClient();
    for (const x of dirty) {
      const v = d.valueOf(x);
      const { error } = await supabase
        .from("crew_member_tiers")
        .update({
          name: v.name.trim() || x.name,
          color: v.color,
          is_full_member: v.is_full_member,
          monthly_fee: toFee(v.monthly),
          session_fee: toFee(v.session),
        })
        .eq("id", x.id)
        .eq("crew_id", crewId);
      if (error) {
        setBusy(null);
        return setErr(duesErrText(t, error.message));
      }
    }
    setBusy(null);
    d.reset();
    router.refresh();
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy("add");
    setErr(null);
    const { error } = await createClient().from("crew_member_tiers").insert({
      crew_id: crewId,
      name: name.trim(),
      color,
      is_full_member: false,
      sort_order: (tiers.at(-1)?.sort_order ?? 0) + 1,
    });
    setBusy(null);
    if (error) return setErr(duesErrText(t, error.message));
    setName("");
    setColor("gray");
    setAdding(false);
    router.refresh();
  }

  async function remove(tier: CrewTier) {
    if (!window.confirm(t("crew.tierDeleteConfirm", { name: tier.name }))) return;
    setBusy(tier.id);
    setErr(null);
    const { data, error } = await createClient().rpc("delete_crew_tier", { p_tier: tier.id });
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
      const { error } = await supabase.from("crew_member_tiers").update({ is_default: false }).eq("id", cur.id);
      if (error) {
        setBusy(null);
        return setErr(duesErrText(t, error.message));
      }
    }
    const { error } = await supabase.from("crew_member_tiers").update({ is_default: true }).eq("id", tier.id);
    setBusy(null);
    if (error) setErr(duesErrText(t, error.message));
    else router.refresh();
  }

  const colorOptions = TIER_COLORS.map((c) => [c, c] as [string, string]);

  return (
    <Panel
      title={t("crew.tierFeesTitle")}
      action={
        <Button variant="outline" size="sm" type="button" onClick={() => setAdding((p) => !p)}>
          <Plus size={14} />
          {t("crew.tierAdd")}
        </Button>
      }
    >
      <p>{t("crew.tierDesc")}</p>
      {err && (
        <p role="alert" className="rx-error">
          {err}
        </p>
      )}
      {adding && (
        <form onSubmit={add} style={{ marginTop: 16 }}>
          <div className="rx-form-grid">
            <Field label={t("crew.tierNamePh")}>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} autoFocus />
            </Field>
            <Field label={t("crew.tierColor")}>
              <Choice label={t("crew.tierColor")} value={color} onChange={(v) => setColor(v as TierColor)} options={colorOptions} />
            </Field>
          </div>
          <div className="rx-actions">
            <Button type="submit" className="rx-primary" disabled={busy != null || !name.trim()}>
              {t("crew.tierAdd")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      )}

      <DataTable
        headers={[t("crew.colTier"), t("crew.colMembers"), t("crew.tierFull"), t("crew.tierMonthly"), t("crew.tierSession"), t("crew.colDefault"), ""]}
        rows={active.map((x) => {
          const v = d.valueOf(x);
          const n = counts[x.id] ?? 0;
          return [
            <span key="n" className="rx-actions" style={{ flexWrap: "nowrap" }}>
              <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: tierBarColor(v.color), flexShrink: 0 }} />
              <Input aria-label={t("crew.tierNamePh")} value={v.name} maxLength={20} disabled={busy != null} onChange={(e) => d.set(x.id, { name: e.target.value }, x)} style={{ minWidth: 110 }} />
              <Choice label={t("crew.tierColor")} value={v.color} onChange={(c) => d.set(x.id, { color: c }, x)} options={colorOptions} />
            </span>,
            <strong key="c" className="rx-number">
              {n}
            </strong>,
            <Switch key="f" checked={v.is_full_member} disabled={busy != null} aria-label={t("crew.tierFull")} onCheckedChange={(next) => d.set(x.id, { is_full_member: next }, x)} />,
            <Input key="m" type="number" min="0" aria-label={`${x.name} ${t("crew.tierMonthly")}`} value={v.monthly} placeholder={t("crew.tierFeeNone2")} disabled={busy != null} onChange={(e) => d.set(x.id, { monthly: e.target.value }, x)} style={{ width: 120 }} />,
            <Input key="s" type="number" min="0" aria-label={`${x.name} ${t("crew.tierSession")}`} value={v.session} placeholder={t("crew.tierFeeNone2")} disabled={busy != null} onChange={(e) => d.set(x.id, { session: e.target.value }, x)} style={{ width: 120 }} />,
            <span key="d">
              {x.is_default ? (
                <Chip tone={tierChipTone(v.color)}>{t("crew.colDefault")}</Chip>
              ) : (
                <Button variant="ghost" size="sm" type="button" disabled={busy != null} onClick={() => makeDefault(x)}>
                  {t("crew.tierMakeDefault")}
                </Button>
              )}
            </span>,
            <Button key="x" variant="ghost" size="sm" type="button" aria-label={t("crew.tierDelete")} title={n > 0 ? t("crew.tierDeleteNote") : undefined} disabled={busy != null || x.is_default || n > 0} onClick={() => remove(x)}>
              ×
            </Button>,
          ];
        })}
      />
      <div className="rx-finance-ledger-total">
        <span>{t("crew.expectedMonthly")}</span>
        <strong>
          {won(expected)} <small className="rx-muted">· {t("crew.expectedMembers", { n: billable })}</small>
        </strong>
      </div>
      <Hint>
        {t("crew.tierDefaultNote")} · {t("crew.tierDeleteNote")} · {t("crew.tierFeeHint")}
        {archived.length > 0 && ` · ${t("crew.tierArchivedList")}: ${archived.map((x) => x.name).join(", ")}`}
      </Hint>
      <div className="rx-actions">
        <span className="rx-muted">{dirty.length > 0 ? t("crew.unsavedN", { n: dirty.length }) : t("crew.noChanges")}</span>
        {dirty.length > 0 && (
          <Button variant="outline" type="button" onClick={d.reset} disabled={busy != null}>
            {t("crew.revert")}
          </Button>
        )}
        <Button className="rx-primary" type="button" onClick={() => void save()} disabled={busy != null || dirty.length === 0}>
          {busy === "save" ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </Panel>
  );
}
