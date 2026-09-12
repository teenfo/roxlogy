"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import {
  btnAccentGhost,
  btnGhost,
  inputCls,
} from "@/components/ui/settings-ui";

type Hit = {
  name: string;
  context: string;
  personRef?: string | null;
};

/** HYROX 공식 기록 연동 — 본인 이름 검색 → 내 기록 선택 → person_ref 저장.
 *  연동하면 주간 배치가 새 공식 기록을 자동 임포트한다. */
export function HyroxLinkForm({
  linkedName,
}: {
  linkedName: string | null;
}) {
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
        setImportMsg(
          t("hyroxLink.importDone", {
            n: (body.imported ?? 0) + (body.enriched ?? 0),
          }),
        );
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
        body: JSON.stringify({
          season: "season-9",
          lastName: last.trim(),
          firstName: first.trim(),
        }),
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
    const { error } = await supabase
      .from("profiles")
      .update({ hyrox_person_ref: h.personRef, hyrox_athlete_name: h.name })
      .eq("id", u.user.id);
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
    await supabase
      .from("profiles")
      .update({ hyrox_person_ref: null, hyrox_athlete_name: null })
      .eq("id", u.user.id);
    setBusy(false);
    router.refresh();
  }

  if (linkedName) {
    // 저장된 이름이 더블 페어명("choho kim, juhwan kim")일 수 있다 —
    // 연동 기준은 첫 번째 인물이므로 본인 이름만 크게 보여준다
    const person = linkedName.split(",")[0].trim();
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-5 px-[22px] py-[18px] max-md:grid-cols-1 max-md:gap-4 max-md:px-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-extrabold">
              {t("hyroxLink.title")}
            </h3>
            <span className="flex items-center gap-1.5 rounded-[5px] bg-success-bg px-2 py-[3px] text-xs font-bold text-success">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success" />
              {t("hyroxLink.linkedBadge")}
            </span>
          </div>
          <p className="mt-1.5 text-sm text-foreground/80">
            <span className="font-bold text-foreground">{person}</span>
            {" · "}
            {t("hyroxLink.autoWeekly")}
          </p>
          <p className="mt-1 text-xs text-muted">{t("hyroxLink.linkedNote")}</p>
          {importMsg && (
            <p className="mt-2 text-xs text-muted">{importMsg}</p>
          )}
        </div>

        <div className="flex flex-col items-end gap-2 max-md:flex-row max-md:items-center max-md:justify-between">
          <button
            type="button"
            onClick={importNow}
            disabled={importing}
            className={btnAccentGhost}
          >
            {importing ? t("hyroxLink.importing") : t("hyroxLink.importNow")}
          </button>
          <button
            type="button"
            onClick={unlink}
            disabled={busy || importing}
            className="text-xs text-muted transition-colors hover:text-danger disabled:opacity-50"
          >
            {t("hyroxLink.unlink")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-[22px] py-[18px] max-md:px-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[15px] font-extrabold">{t("hyroxLink.title")}</h3>
          <span className="rounded-[5px] bg-label-bg px-2 py-[3px] text-xs font-bold text-label">
            {t("hyroxLink.notLinked")}
          </span>
        </div>
        <p className="mt-1.5 text-xs text-muted">{t("hyroxLink.desc")}</p>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 max-sm:grid-cols-2">
        <input
          value={last}
          onChange={(e) => setLast(e.target.value)}
          placeholder={t("raceNew.search.lastName")}
          className={inputCls}
        />
        <input
          value={first}
          onChange={(e) => setFirst(e.target.value)}
          placeholder={t("raceNew.search.firstName")}
          className={inputCls}
        />
        <button
          type="button"
          onClick={search}
          disabled={busy || last.trim().length < 2}
          className={`${btnGhost} h-[42px] max-sm:col-span-2`}
        >
          {busy ? "…" : t("raceNew.import.searchBtn")}
        </button>
      </div>

      {err && <p role="alert" className="text-xs text-danger">{err}</p>}
      {hits && hits.length === 0 && (
        <p className="text-xs text-muted">{t("hyroxLink.noHits")}</p>
      )}
      {hits && hits.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {hits.slice(0, 6).map((h, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => link(h)}
                disabled={busy}
                className="flex w-full items-center gap-2 rounded-lg border border-line bg-page px-3 py-2.5 text-left text-xs transition-colors hover:border-line-accent disabled:opacity-50"
              >
                <span className="shrink-0 font-bold">{h.name}</span>
                <span className="min-w-0 truncate text-muted">{h.context}</span>
                <span className="ml-auto shrink-0 font-bold text-accent">
                  {t("hyroxLink.thisIsMe")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
