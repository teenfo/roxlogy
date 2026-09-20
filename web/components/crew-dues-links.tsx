"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { won } from "@/lib/won";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Chip, DataTable, Field, Hint, Panel, Segments } from "@/components/rox/ui";

export type DuesAudience = "all" | "member" | "associate";

export type DuesLink = {
  id: string;
  label: string;
  url: string | null; // 없으면 계좌이체 안내용 (명칭+금액만)
  amount: number | null;
  audience: DuesAudience;
};

// url 은 선택 — 비어 있거나 http(s) 여야 한다
const urlOk = (v: string) => v.trim() === "" || /^https?:\/\//i.test(v.trim());

/**
 * 회비 납부 링크 관리 — 스태프 전용. 시안에 없는 우리 기능이라 Panel + DataTable + Field 로만 그린다(§4).
 * 카카오페이 송금 링크 등을 명칭과 함께 여러 개 등록하고, 링크마다 표시 대상(전체/정회원/일반회원)을
 * 지정한다. 소개 탭에서는 RLS 가 본인 등급에 해당하는 링크만 내려준다.
 */
export function CrewDuesLinksManage({ crewId, items }: { crewId: string; items: DuesLink[] }) {
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
    if (error) return setErr(error.message);
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
    if (error) return setErr(error.message);
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

  /** 추가·수정이 같은 칸을 쓴다 — 수정은 표 아래 같은 폼으로 열린다 */
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
      <div className="rx-form-grid">
        <Field label={t("crew.duesLabelPh")}>
          <Input value={v.label} onChange={(e) => on.label(e.target.value)} maxLength={60} />
        </Field>
        <Field label={`${t("crew.duesAmountPh")} (₩)`}>
          <Input value={v.amount} onChange={(e) => on.amount(e.target.value)} inputMode="numeric" />
        </Field>
      </div>
      <Field label={t("crew.duesUrlPh")}>
        <Input value={v.url} onChange={(e) => on.url(e.target.value)} maxLength={500} inputMode="url" placeholder="https://" />
      </Field>
      <Field label={t("crew.duesAudience")}>
        <Segments
          label={t("crew.duesAudience")}
          value={v.audience}
          onChange={(x) => on.audience(x as DuesAudience)}
          options={(["all", "member", "associate"] as const).map((a) => [a, audLabel[a]] as [string, string])}
        />
      </Field>
    </>
  );

  const editing = items.find((l) => l.id === editId) ?? null;

  return (
    <Panel title={t("crew.duesTitle")}>
      <p>{t("crew.duesHint")}</p>
      {items.length ? (
        <DataTable
          headers={[t("crew.duesLinkCol"), t("crew.duesAudience"), t("crew.finAmount"), ""]}
          rows={items.map((l) => [
            <span key="l">
              <b>{l.label}</b>
              {l.url ? (
                <small className="rx-block rx-muted">
                  <a href={l.url} target="_blank" rel="noreferrer noopener">
                    {l.url}
                  </a>
                </small>
              ) : (
                <small className="rx-block rx-muted">{t("crew.duesNoLink")}</small>
              )}
            </span>,
            <Chip key="a" tone={l.audience === "member" ? "blue" : l.audience === "associate" ? "yellow" : "neutral"}>
              {audLabel[l.audience]}
            </Chip>,
            <strong key="m" className="rx-number">
              {l.amount != null ? won(l.amount) : "—"}
            </strong>,
            <span key="x" className="rx-actions" style={{ flexWrap: "nowrap", justifyContent: "flex-end" }}>
              <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={() => startEdit(l)}>
                {t("common.edit")}
              </Button>
              <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={() => del(l.id)}>
                {t("common.delete")}
              </Button>
            </span>,
          ])}
        />
      ) : (
        <Hint>{t("crew.duesLinksEmpty")}</Hint>
      )}

      {editing ? (
        <form onSubmit={saveEdit} style={{ marginTop: 20 }}>
          <div className="rx-section-label">{t("common.edit")} · {editing.label}</div>
          {fields(
            { label: eLabel, url: eUrl, amount: eAmount, audience: eAudience },
            { label: setELabel, url: setEUrl, amount: setEAmount, audience: setEAudience },
          )}
          {err && (
            <p role="alert" className="rx-error">
              {err}
            </p>
          )}
          <div className="rx-actions">
            <Button type="submit" className="rx-primary" disabled={busy || !eLabel.trim() || !urlOk(eUrl)}>
              {t("common.save")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditId(null)}>
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <form onSubmit={add} style={{ marginTop: 20 }}>
          <div className="rx-section-label">{t("crew.newLink")}</div>
          {fields(
            { label, url, amount, audience },
            { label: setLabel, url: setUrl, amount: setAmount, audience: setAudience },
          )}
          {err && (
            <p role="alert" className="rx-error">
              {err}
            </p>
          )}
          <Button type="submit" variant="outline" disabled={busy || !label.trim() || !urlOk(url)}>
            <Plus size={15} />
            {t("crew.duesAdd")}
          </Button>
        </form>
      )}
    </Panel>
  );
}
