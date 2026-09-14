"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
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

/** 등급별 활동 회원 수 — tier_id → 명 */
export type TierCounts = Record<string, number>;

const won = (n: number) => `₩${n.toLocaleString("ko-KR")}`;

function toFee(v: string): number | null {
  const n = parseInt(v.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 카드 — 회비·등급 표가 같은 모양을 쓴다 */
const CARD = "overflow-hidden rounded-[14px] border border-line bg-card";
const HEAD = "flex items-start justify-between gap-3 border-b border-line px-[18px] py-3.5";
const COL = "text-[11px] font-bold tracking-[0.06em] text-[#777]";

/** ₩ 접두가 붙은 금액 칸 */
function FeeInput({
  value,
  onChange,
  disabled,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  label: string;
}) {
  const { t } = useI18n();
  return (
    <span className="flex h-[34px] items-center overflow-hidden rounded-lg border border-line-strong bg-page focus-within:border-accent">
      <span aria-hidden className="px-2 text-xs text-[#666]">
        ₩
      </span>
      <input
        aria-label={label}
        className="tabular h-full min-w-0 flex-1 border-0 bg-transparent pr-2.5 text-right text-sm outline-none disabled:opacity-50"
        value={value}
        placeholder={t("crew.tierFeeNone2")}
        inputMode="numeric"
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </span>
  );
}

/** 등급 색 고르기 — 원을 누르면 팔레트가 뜬다. 배경 버튼으로 바깥 클릭을 받는다
 *  (document 리스너를 달지 않아도 되고 키보드로도 닫힌다). */
function ColorPicker({
  color,
  onPick,
  disabled,
}: {
  color: string;
  onPick: (c: TierColor) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <span className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        aria-label={t("crew.tierColor")}
        aria-expanded={open}
        onClick={() => setOpen((p) => !p)}
        className={`block h-7 w-7 rounded-full border-2 border-[#333] ${tierBadgeClass(color)} disabled:opacity-50`}
      />
      {open && (
        <>
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <span className="absolute left-0 top-9 z-20 flex gap-1.5 rounded-[10px] border border-[#333] bg-[#1a1a1a] p-2 shadow-[0_12px_30px_rgba(0,0,0,.5)]">
            {TIER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => {
                  onPick(c);
                  setOpen(false);
                }}
                className={`h-6 w-6 rounded-full border-2 ${tierBadgeClass(c)} ${
                  color === c ? "border-foreground" : "border-[#333]"
                }`}
              />
            ))}
          </span>
        </>
      )}
    </span>
  );
}

/** 40×24 토글 */
function Toggle({
  on,
  onChange,
  label,
  disabled,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
        on ? "bg-accent" : "bg-[#333]"
      }`}
    >
      <span
        className={`absolute top-[3px] h-[18px] w-[18px] rounded-full transition-[left] ${
          on ? "left-[19px] bg-background" : "left-[3px] bg-muted"
        }`}
      />
    </button>
  );
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
 * 회원 등급 — 운영진 전용. **여기서는 등급만 다룬다**: 이름·색·정회원 권한·기본 등급·삭제.
 * 금액(월회비·회차비)은 회비 탭의 CrewTierFees 가 맡는다 — 회비 설정이 두 탭에 흩어져
 * 있어 어디서 고치는지 헷갈렸다(2026-09-14 피드백). 그래서 디자인 시안의 표에 있던
 * 월 회비·회차비 열은 빼고, 그 자리를 회비 탭으로 넘겼다.
 *
 * 이름·색·권한은 로컬로 모았다가 "저장"으로 한 번에 쓴다(표에서 칸마다 저장하면 클릭
 * 한 번이 요청 하나가 된다). 기본 등급 지정과 삭제는 단발 동작이라 즉시 처리한다.
 */
export function CrewTierManage({
  crewId,
  tiers,
  counts = {},
}: {
  crewId: string;
  tiers: CrewTier[];
  counts?: TierCounts;
}) {
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
  }));
  const dirty = d.changed(active);

  async function save() {
    setBusy("save");
    setErr(null);
    const supabase = createClient();
    for (const x of dirty) {
      const v = d.valueOf(x);
      const { error } = await supabase
        .from("crew_member_tiers")
        .update({ name: v.name.trim() || x.name, color: v.color, is_full_member: v.is_full_member })
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
    // 금액은 비워 두고 만든다 — 요금은 회비 탭에서 정한다
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

  // 좁은 화면에서는 5열이 들어가지 않아 이름 칸이 몇 픽셀로 찌그러진다(390px 확인).
  // 그래서 모바일은 이름 한 줄 + 조작 한 줄로 쌓고, md 부터 한 줄 표가 된다.
  // 조작 줄은 `md:contents` 로 격자에서 사라져 자식들이 그대로 표의 칸이 된다.
  const cols =
    "md:grid md:grid-cols-[minmax(0,1.4fr)_70px_110px_80px_36px] md:items-center md:gap-3";
  const cellLabel = "text-[11px] font-bold text-[#777] md:hidden";

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-xl">
          <h2 className="text-lg font-extrabold">{t("crew.tierTitle")}</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">{t("crew.tierDesc")}</p>
        </div>
        <button
          type="button"
          onClick={() => setAdding((p) => !p)}
          className="h-[38px] shrink-0 rounded-lg bg-accent px-4 text-sm font-extrabold text-background hover:brightness-110"
        >
          + {t("crew.tierAdd")}
        </button>
      </div>

      {err && (
        <p role="alert" className="text-sm text-danger">
          {err}
        </p>
      )}

      {adding && (
        <form onSubmit={add} className={`${CARD} flex flex-wrap items-center gap-2.5 p-[18px]`}>
          <ColorPicker color={color} onPick={setColor} />
          <input
            // size 를 줄이지 않으면 input 의 기본 폭(약 300px)이 부모의 min-content 를
            // 밀어 올려 좁은 화면에서 페이지가 가로로 넘친다 — flex-1 은 이걸 못 막는다
            size={1}
            className="h-10 min-w-0 flex-1 rounded-lg border border-line-strong bg-page px-3 text-sm outline-none focus:border-accent"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("crew.tierNamePh")}
            maxLength={20}
            autoFocus
          />
          <button
            type="submit"
            disabled={busy != null || !name.trim()}
            className="h-10 rounded-lg bg-accent px-4 text-sm font-extrabold text-background disabled:opacity-40"
          >
            {t("crew.tierAdd")}
          </button>
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="h-10 px-2 text-sm text-muted hover:text-foreground"
          >
            {t("common.cancel")}
          </button>
        </form>
      )}

      <div className={CARD}>
        <div className={`hidden ${cols} ${COL} border-b border-[#1c1c1c] px-[18px] py-2.5`} aria-hidden>
          <span>{t("crew.colTier")}</span>
          <span className="text-center">{t("crew.colMembers")}</span>
          <span className="text-center">{t("crew.tierFull")}</span>
          <span className="text-center">{t("crew.colDefault")}</span>
          <span />
        </div>

        {active.map((x) => {
          const v = d.valueOf(x);
          const n = counts[x.id] ?? 0;
          return (
            <div
              key={x.id}
              className={`${cols} border-b border-[#1c1c1c] px-[18px] py-3 hover:bg-card-hover`}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <ColorPicker
                  color={v.color}
                  disabled={busy != null}
                  onPick={(c) => d.set(x.id, { color: c }, x)}
                />
                <span
                  className={`hidden shrink-0 rounded-[5px] px-2 py-[3px] text-[11px] font-bold lg:inline ${tierBadgeClass(v.color)}`}
                >
                  {v.name || x.name}
                </span>
                <input
                  aria-label={t("crew.tierNamePh")}
                  size={1}
                  className="h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2.5 text-sm font-semibold outline-none hover:border-[#333] hover:bg-page focus:border-accent focus:bg-page"
                  value={v.name}
                  maxLength={20}
                  disabled={busy != null}
                  onChange={(e) => d.set(x.id, { name: e.target.value }, x)}
                />
              </span>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 pl-[38px] md:contents">
                <span className="tabular flex items-center gap-1.5 text-sm font-bold md:justify-center">
                  <span className={cellLabel}>{t("crew.colMembers")}</span>
                  {n}
                </span>

                <span className="flex items-center gap-1.5 md:justify-center">
                  <span className={cellLabel}>{t("crew.tierFull")}</span>
                  <Toggle
                    on={v.is_full_member}
                    disabled={busy != null}
                    label={t("crew.tierFull")}
                    onChange={(next) => d.set(x.id, { is_full_member: next }, x)}
                  />
                </span>

                <span className="flex items-center gap-1.5 md:justify-center">
                  <span className={cellLabel}>{t("crew.colDefault")}</span>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={x.is_default}
                    aria-label={t("crew.tierMakeDefault")}
                    disabled={busy != null || x.is_default}
                    onClick={() => makeDefault(x)}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                      x.is_default ? "border-accent" : "border-[#444] hover:border-muted"
                    }`}
                  >
                    {x.is_default && <span className="h-2.5 w-2.5 rounded-full bg-accent" />}
                  </button>
                </span>

                <button
                  type="button"
                  aria-label={t("crew.tierDelete")}
                  title={n > 0 ? t("crew.tierDeleteNote") : undefined}
                  disabled={busy != null || x.is_default || n > 0}
                  onClick={() => remove(x)}
                  className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm text-danger hover:bg-danger-card disabled:cursor-not-allowed disabled:text-[#444] disabled:hover:bg-transparent md:ml-0 md:justify-self-center"
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}

        <p className="flex flex-wrap gap-x-4 gap-y-1 px-[18px] py-3 text-xs text-[#777]">
          <span>● {t("crew.tierDefaultNote")}</span>
          <span>● {t("crew.tierDeleteNote")}</span>
        </p>
      </div>

      {archived.length > 0 && (
        <p className="text-xs text-muted">
          {t("crew.tierArchivedList")}: {archived.map((x) => x.name).join(", ")}
        </p>
      )}

      <div className="flex items-center justify-end gap-3">
        <span className="text-[13px] text-muted">
          {dirty.length > 0 ? t("crew.unsavedN", { n: dirty.length }) : t("crew.noChanges")}
        </span>
        {dirty.length > 0 && (
          <button
            type="button"
            onClick={d.reset}
            disabled={busy != null}
            className="h-10 rounded-lg border border-line-strong bg-control px-4 text-sm font-semibold hover:border-muted/60"
          >
            {t("crew.revert")}
          </button>
        )}
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy != null || dirty.length === 0}
          className="h-10 rounded-lg bg-accent px-5 text-sm font-extrabold text-background hover:brightness-110 disabled:bg-[#2a2a2a] disabled:text-[#666]"
        >
          {busy === "save" ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </div>
  );
}

/**
 * 등급별 회비 — 회비 탭. 등급이 곧 요금표라 등급마다 월회비·회차비를 여기서 정한다.
 * 시안에서는 읽기 전용 표였지만, 금액 편집이 회비 탭으로 넘어왔으므로 입력칸으로 둔다
 * (2026-09-14). 등급의 이름·색·권한은 등급 탭이 맡는다.
 *
 * 등급 표와 같이 로컬로 모았다가 "저장"으로 한 번에 쓴다. 비우면 요금 없음(null)이고,
 * 월회비가 없는 등급은 월 일괄 청구에서 빠진다.
 */
export function CrewTierFees({
  crewId,
  tiers,
  counts = {},
  tiersHref,
}: {
  crewId: string;
  tiers: CrewTier[];
  counts?: TierCounts;
  /** "등급 추가·이름 변경 →" 이 가는 곳 */
  tiersHref: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const active = tiers.filter((x) => !x.archived_at);
  const d = useDraft(tiers, (x) => ({
    monthly: x.monthly_fee == null ? "" : String(x.monthly_fee),
    session: x.session_fee == null ? "" : String(x.session_fee),
  }));
  const dirty = d.changed(active);

  async function save() {
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    for (const x of dirty) {
      const v = d.valueOf(x);
      const { error } = await supabase
        .from("crew_member_tiers")
        .update({ monthly_fee: toFee(v.monthly), session_fee: toFee(v.session) })
        .eq("id", x.id)
        .eq("crew_id", crewId);
      if (error) {
        setBusy(false);
        return setErr(duesErrText(t, error.message));
      }
    }
    setBusy(false);
    d.reset();
    router.refresh();
  }

  // 이번 달 예상 월 회비 청구 = Σ(월회비 × 그 등급 활동 인원). 저장 전 값으로 미리 센다.
  const expected = active.reduce((a, x) => {
    const fee = toFee(d.valueOf(x).monthly) ?? 0;
    return a + fee * (counts[x.id] ?? 0);
  }, 0);
  const billable = active.reduce(
    (a, x) => a + (toFee(d.valueOf(x).monthly) != null ? (counts[x.id] ?? 0) : 0),
    0,
  );

  const cols = "grid grid-cols-[minmax(0,1fr)_92px_92px] items-center gap-2 px-[18px] md:grid-cols-[minmax(0,1fr)_110px_110px] md:gap-3";

  return (
    <div className={CARD}>
      <div className={HEAD}>
        <div className="min-w-0">
          <p className="text-[15px] font-extrabold">{t("crew.duesFeeTitle")}</p>
          <p className="mt-0.5 text-xs text-[#777]">{t("crew.duesFeeSub")}</p>
        </div>
        <Link href={tiersHref} className="shrink-0 text-xs text-accent hover:underline">
          {t("crew.tierGoTiers")}
        </Link>
      </div>

      {active.length === 0 ? (
        <p className="px-[18px] py-6 text-center text-[13px] text-[#666]">{t("crew.tierFeeNone")}</p>
      ) : (
        <>
          <div className={`${cols} ${COL} border-b border-[#1c1c1c] py-2`} aria-hidden>
            <span>{t("crew.colTier")}</span>
            <span className="text-right">{t("crew.tierMonthly")}</span>
            <span className="text-right">{t("crew.tierSession")}</span>
          </div>

          {active.map((x) => {
            const v = d.valueOf(x);
            return (
              <div key={x.id} className={`${cols} border-b border-[#1c1c1c] py-3`}>
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={`shrink-0 rounded-[5px] px-2 py-[3px] text-[11px] font-bold ${tierBadgeClass(x.color)}`}
                  >
                    {x.name}
                  </span>
                  <span className="text-xs text-[#777]">
                    {t("crew.memberN", { n: counts[x.id] ?? 0 })}
                  </span>
                </span>
                <FeeInput
                  label={`${x.name} ${t("crew.tierMonthly")}`}
                  value={v.monthly}
                  disabled={busy}
                  onChange={(nv) => d.set(x.id, { monthly: nv }, x)}
                />
                <FeeInput
                  label={`${x.name} ${t("crew.tierSession")}`}
                  value={v.session}
                  disabled={busy}
                  onChange={(nv) => d.set(x.id, { session: nv }, x)}
                />
              </div>
            );
          })}

          <div className="flex flex-wrap items-center justify-between gap-2 px-[18px] py-3 text-xs text-muted">
            <span>{t("crew.expectedMonthly")}</span>
            <strong className="tabular font-bold text-foreground">
              {won(expected)}{" "}
              <span className="font-medium text-[#777]">
                · {t("crew.expectedMembers", { n: billable })}
              </span>
            </strong>
          </div>
        </>
      )}

      {err && (
        <p role="alert" className="px-[18px] pb-2 text-sm text-danger">
          {err}
        </p>
      )}

      <div className="flex items-center justify-end gap-3 border-t border-line bg-inset px-[18px] py-3">
        <span className="text-xs text-muted">
          {dirty.length > 0 ? t("crew.unsavedN", { n: dirty.length }) : t("crew.tierFeeHint")}
        </span>
        {dirty.length > 0 && (
          <button
            type="button"
            onClick={d.reset}
            disabled={busy}
            className="h-9 shrink-0 rounded-lg border border-line-strong bg-control px-3 text-xs font-semibold hover:border-muted/60"
          >
            {t("crew.revert")}
          </button>
        )}
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || dirty.length === 0}
          className="h-9 shrink-0 rounded-lg bg-accent px-4 text-xs font-extrabold text-background hover:brightness-110 disabled:bg-[#2a2a2a] disabled:text-[#666]"
        >
          {busy ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </div>
  );
}
