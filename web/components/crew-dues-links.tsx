"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

export type DuesAudience = "all" | "member" | "associate";

export type DuesLink = {
  id: string;
  label: string;
  url: string | null; // 없으면 계좌이체 안내용 (명칭+금액만)
  amount: number | null;
  audience: DuesAudience;
};

const won = (n: number) => `₩${n.toLocaleString("ko-KR")}`;
// url 은 선택 — 비어 있거나 http(s) 여야 한다
const urlOk = (v: string) => v.trim() === "" || /^https?:\/\//i.test(v.trim());

/** 회비 납부 링크 관리 — 스태프 전용. 카카오페이 송금 링크 등을 명칭과 함께
 *  여러 개 등록하고, 링크마다 표시 대상(전체/정회원/일반회원)을 지정한다.
 *  소개 탭에서는 RLS 가 본인 등급에 해당하는 링크만 내려준다. */
export function CrewDuesLinksManage({
  crewId,
  items,
}: {
  crewId: string;
  items: DuesLink[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [amount, setAmount] = useState("");
  const [audience, setAudience] = useState<DuesAudience>("all");
  // 인라인 수정 상태 — 수정 중인 링크 id 와 편집 필드
  const [editId, setEditId] = useState<string | null>(null);
  const [eLabel, setELabel] = useState("");
  const [eUrl, setEUrl] = useState("");
  const [eAmount, setEAmount] = useState("");
  const [eAudience, setEAudience] = useState<DuesAudience>("all");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const audLabel: Record<DuesAudience, string> = {
    all: t("crew.duesAudAll"),
    member: t("crew.duesAudMember"),
    associate: t("crew.duesAudAssociate"),
  };
  const audBadge: Record<DuesAudience, string> = {
    all: "bg-background text-muted",
    member: "bg-track/15 text-track",
    associate: "bg-accent/15 text-accent",
  };

  const parseAmount = (v: string) => {
    const raw = v.replace(/[^\d]/g, "");
    return raw ? parseInt(raw, 10) : null;
  };

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !urlOk(url)) return;
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase.from("crew_dues_links").insert({
      crew_id: crewId,
      label: label.trim(),
      url: url.trim() || null,
      amount: parseAmount(amount),
      audience,
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setLabel("");
    setUrl("");
    setAmount("");
    setAudience("all");
    router.refresh();
  }

  function startEdit(l: DuesLink) {
    setEditId(l.id);
    setELabel(l.label);
    setEUrl(l.url ?? "");
    setEAmount(l.amount != null ? String(l.amount) : "");
    setEAudience(l.audience);
    setErr(null);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId || !eLabel.trim() || !urlOk(eUrl)) return;
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("crew_dues_links")
      .update({
        label: eLabel.trim(),
        url: eUrl.trim() || null,
        amount: parseAmount(eAmount),
        audience: eAudience,
      })
      .eq("id", editId);
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setEditId(null);
    router.refresh();
  }

  async function del(id: string) {
    if (!window.confirm(t("crew.duesDelConfirm"))) return;
    setBusy(true);
    const supabase = createClient();
    await supabase.from("crew_dues_links").delete().eq("id", id);
    setBusy(false);
    router.refresh();
  }

  const field =
    "h-[38px] w-full min-w-0 rounded-lg border border-line-strong bg-page px-3 text-sm outline-none focus:border-accent";
  const pill = (on: boolean) =>
    `h-7 rounded-full px-2.5 text-xs font-bold ${
      on ? "bg-accent text-background" : "border border-line-strong bg-control text-muted hover:text-foreground"
    }`;
  const iconBtn =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#333] text-xs disabled:opacity-40";

  /** 추가·수정이 같은 칸을 쓴다 — 수정은 행이 폼으로 바뀐다 */
  const fields = (
    v: { label: string; url: string; amount: string; audience: DuesAudience },
    on: {
      label: (x: string) => void;
      url: (x: string) => void;
      amount: (x: string) => void;
      audience: (x: DuesAudience) => void;
    },
  ) => (
    <>
      <input
        className={field}
        value={v.label}
        onChange={(e) => on.label(e.target.value)}
        placeholder={t("crew.duesLabelPh")}
        maxLength={60}
        aria-label={t("crew.duesLabelPh")}
      />
      <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-2">
        <input
          className={field}
          value={v.url}
          onChange={(e) => on.url(e.target.value)}
          placeholder={t("crew.duesUrlPh")}
          maxLength={500}
          inputMode="url"
          aria-label={t("crew.duesUrlPh")}
        />
        <span className="flex h-[38px] items-center overflow-hidden rounded-lg border border-line-strong bg-page focus-within:border-accent">
          <span aria-hidden className="px-2 text-xs text-[#666]">
            ₩
          </span>
          <input
            className="tabular h-full min-w-0 flex-1 border-0 bg-transparent pr-2.5 text-right text-sm outline-none"
            value={v.amount}
            onChange={(e) => on.amount(e.target.value)}
            placeholder={t("crew.duesAmountPh")}
            inputMode="numeric"
            aria-label={t("crew.duesAmountPh")}
          />
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted">{t("crew.duesAudience")}</span>
        {(["all", "member", "associate"] as const).map((a) => (
          <button
            key={a}
            type="button"
            aria-pressed={v.audience === a}
            onClick={() => on.audience(a)}
            className={pill(v.audience === a)}
          >
            {audLabel[a]}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <div className="overflow-hidden rounded-[14px] border border-line bg-card">
      <div className="border-b border-line px-[18px] py-3.5">
        <p className="text-[15px] font-extrabold">{t("crew.duesTitle")}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-[#777]">{t("crew.duesHint")}</p>
      </div>

      <div className="flex flex-col">
        {items.map((l) =>
          editId === l.id ? (
            <form
              key={l.id}
              onSubmit={saveEdit}
              className="flex flex-col gap-2.5 border-b border-[#1c1c1c] bg-inset px-[18px] py-3.5"
            >
              {fields(
                { label: eLabel, url: eUrl, amount: eAmount, audience: eAudience },
                { label: setELabel, url: setEUrl, amount: setEAmount, audience: setEAudience },
              )}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busy || !eLabel.trim() || !urlOk(eUrl)}
                  className="h-9 rounded-lg bg-accent px-4 text-xs font-extrabold text-background hover:brightness-110 disabled:opacity-40"
                >
                  {t("common.save")}
                </button>
                <button
                  type="button"
                  onClick={() => setEditId(null)}
                  className="h-9 px-2 text-xs text-muted hover:text-foreground"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </form>
          ) : (
            <div
              key={l.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-[#1c1c1c] px-[18px] py-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-bold">{l.label}</span>
                  {l.amount != null && (
                    <span className="tabular text-[13px] font-bold text-accent">
                      {won(l.amount)}
                    </span>
                  )}
                </div>
                <div className="mt-[3px] flex min-w-0 items-center gap-2 text-xs text-[#777]">
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${audBadge[l.audience]}`}>
                    {audLabel[l.audience]}
                  </span>
                  {l.url ? (
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="truncate hover:text-accent hover:underline"
                    >
                      {l.url}
                    </a>
                  ) : (
                    <span className="truncate">{t("crew.duesNoLink")}</span>
                  )}
                </div>
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => startEdit(l)}
                  disabled={busy}
                  aria-label={t("common.edit")}
                  className={`${iconBtn} text-[#c9c9c9] hover:border-muted`}
                >
                  ✎
                </button>
                <button
                  type="button"
                  onClick={() => del(l.id)}
                  disabled={busy}
                  aria-label={t("common.delete")}
                  className={`${iconBtn} text-danger hover:bg-danger-card`}
                >
                  ×
                </button>
              </div>
            </div>
          ),
        )}
        {items.length === 0 && (
          <p className="px-[18px] py-6 text-center text-[13px] text-[#666]">
            {t("crew.duesLinksEmpty")}
          </p>
        )}
      </div>

      <form
        onSubmit={add}
        className="flex flex-col gap-2.5 border-t border-line bg-inset px-[18px] py-4"
      >
        <p className="text-xs font-bold text-muted">{t("crew.newLink")}</p>
        {fields(
          { label, url, amount, audience },
          { label: setLabel, url: setUrl, amount: setAmount, audience: setAudience },
        )}
        {err && (
          <p role="alert" className="text-xs text-danger">
            {err}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !label.trim() || !urlOk(url)}
          className="h-[38px] self-start rounded-lg bg-accent px-4 text-sm font-extrabold text-background hover:brightness-110 disabled:opacity-40"
        >
          + {t("crew.duesAdd")}
        </button>
      </form>
    </div>
  );
}
