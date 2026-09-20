"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Chip, Field, Hint, Panel } from "@/components/rox/ui";

type Hit = {
  name: string;
  context: string;
  personRef?: string | null;
};

/**
 * HYROX 공식 기록 연동 — 시안 Settings(연동) Panel "HYROX 공식 기록" 그대로:
 * .rx-switch-row(공식 기록 연동 · 원본 계정: 매주 자동 동기화 + Chip 연동 중) · Hint · Button.
 * 본인 이름 검색 → 내 기록 선택 → person_ref 저장. 연동하면 주간 배치가 새 공식 기록을 자동 임포트한다.
 */
export function HyroxLinkForm({ linkedName }: { linkedName: string | null }) {
  const { t } = useI18n();
  const router = useRouter();
  const [last, setLast] = useState("");
  const [first, setFirst] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  // 본인 공식 기록 즉시 임포트 (Result API 스로틀 때문에 수십 초 걸릴 수 있음)
  async function importNow() {
    setImporting(true);
    setImportMsg(null);
    try {
      const res = await fetch("/api/hyrox/import-mine", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setImportMsg(t("hyroxLink.importFail"));
      } else {
        setImportMsg(t("hyroxLink.importDone", { n: (body.imported ?? 0) + (body.enriched ?? 0) }));
        router.refresh();
      }
    } catch {
      setImportMsg(t("hyroxLink.importFail"));
    } finally {
      setImporting(false);
    }
  }

  async function search() {
    if (last.trim().length < 2) return;
    setBusy(true);
    setErr(null);
    setHits(null);
    try {
      const res = await fetch("/api/races/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ season: "season-9", lastName: last.trim(), firstName: first.trim() }),
      });
      const body = await res.json();
      setHits(((body.hits ?? []) as Hit[]).filter((h) => h.personRef));
    } catch {
      setErr(t("raceNew.import.failFetch"));
    } finally {
      setBusy(false);
    }
  }

  async function link(h: Hit) {
    setBusy(true);
    const supabase = createClient();
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      setBusy(false);
      return;
    }
    const { error } = await supabase.from("profiles").update({ hyrox_person_ref: h.personRef, hyrox_athlete_name: h.name }).eq("id", u.user.id);
    setBusy(false);
    if (error) setErr(error.message);
    else {
      setHits(null);
      router.refresh();
      // 연동 직후 본인 기록을 바로 가져온다 (주간 배치를 기다리지 않도록)
      void importNow();
    }
  }

  async function unlink() {
    if (!window.confirm(t("hyroxLink.unlinkConfirm"))) return;
    setBusy(true);
    const supabase = createClient();
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      setBusy(false);
      return;
    }
    await supabase.from("profiles").update({ hyrox_person_ref: null, hyrox_athlete_name: null }).eq("id", u.user.id);
    setBusy(false);
    router.refresh();
  }

  if (linkedName) {
    // 저장된 이름이 더블 페어명("choho kim, juhwan kim")일 수 있다 —
    // 연동 기준은 첫 번째 인물이므로 본인 이름만 크게 보여준다
    const person = linkedName.split(",")[0].trim();
    return (
      <Panel title={t("hyroxLink.title")}>
        <div className="rx-switch-row">
          <span>
            <b>{person}</b>
            <small>{t("hyroxLink.autoWeekly")}</small>
          </span>
          <Chip tone="green">{t("hyroxLink.linkedBadge")}</Chip>
        </div>
        <Hint>{importMsg ?? t("hyroxLink.linkedNote")}</Hint>
        <div className="rx-actions">
          <Button type="button" variant="outline" onClick={importNow} disabled={importing}>
            {importing ? t("hyroxLink.importing") : t("hyroxLink.importNow")}
          </Button>
          <Button type="button" variant="ghost" className="rx-pft-close" onClick={unlink} disabled={busy || importing}>
            {t("hyroxLink.unlink")}
          </Button>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title={t("hyroxLink.title")}>
      <div className="rx-switch-row">
        <span>
          <b>{t("hyroxLink.title")}</b>
          <small>{t("hyroxLink.desc")}</small>
        </span>
        <Chip>{t("hyroxLink.notLinked")}</Chip>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <div className="rx-form-grid">
          <Field label={t("raceNew.search.lastName")}>
            <Input value={last} onChange={(e) => setLast(e.target.value)} placeholder={t("raceNew.search.lastName")} />
          </Field>
          <Field label={t("raceNew.search.firstName")}>
            <Input value={first} onChange={(e) => setFirst(e.target.value)} placeholder={t("raceNew.search.firstName")} />
          </Field>
        </div>
        <Button type="submit" variant="outline" disabled={busy || last.trim().length < 2}>
          {busy ? "…" : t("raceNew.import.searchBtn")}
        </Button>
      </form>
      {err && (
        <p role="alert" className="rx-error">
          {err}
        </p>
      )}
      {hits && hits.length === 0 && <Hint>{t("hyroxLink.noHits")}</Hint>}
      {hits && hits.length > 0 && (
        <div>
          {hits.slice(0, 6).map((h, i) => (
            <div key={i} className="rx-record-row" style={{ cursor: "default" }}>
              <span>
                <b>{h.name}</b>
                <small>{h.context}</small>
              </span>
              <Button type="button" size="sm" className="rx-primary" onClick={() => link(h)} disabled={busy}>
                {t("hyroxLink.thisIsMe")}
              </Button>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
