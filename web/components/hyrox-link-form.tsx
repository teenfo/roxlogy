"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

type Hit = {
  name: string;
  context: string;
  personRef?: string | null;
};

const input =
  "rounded-md border border-muted/30 bg-background px-3 py-2 text-sm outline-none focus:border-accent";

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
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm">
            ✓ <span className="font-semibold text-track">{person}</span>
          </p>
          <button
            type="button"
            onClick={unlink}
            disabled={busy || importing}
            className="text-xs text-muted hover:text-red-400 disabled:opacity-50"
          >
            {t("hyroxLink.unlink")}
          </button>
        </div>
        <p className="text-xs text-muted">{t("hyroxLink.linkedNote")}</p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={importNow}
            disabled={importing}
            className="rounded-md border border-accent/40 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/10 disabled:opacity-50"
          >
            {importing ? t("hyroxLink.importing") : t("hyroxLink.importNow")}
          </button>
          {importMsg && <p className="text-xs text-muted">{importMsg}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted">{t("hyroxLink.desc")}</p>
      <div className="flex flex-wrap gap-2">
        <input
          value={last}
          onChange={(e) => setLast(e.target.value)}
          placeholder={t("raceNew.search.lastName")}
          className={input}
        />
        <input
          value={first}
          onChange={(e) => setFirst(e.target.value)}
          placeholder={t("raceNew.search.firstName")}
          className={input}
        />
        <button
          type="button"
          onClick={search}
          disabled={busy || last.trim().length < 2}
          className="rounded-md bg-surface px-4 py-2 text-sm font-semibold hover:text-accent disabled:opacity-50"
        >
          {busy ? "…" : t("raceNew.import.searchBtn")}
        </button>
      </div>
      {err && <p className="text-xs text-red-400">{err}</p>}
      {hits && hits.length === 0 && (
        <p className="text-xs text-muted">{t("hyroxLink.noHits")}</p>
      )}
      {hits && hits.length > 0 && (
        <ul className="flex flex-col gap-1">
          {hits.slice(0, 6).map((h, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => link(h)}
                disabled={busy}
                className="flex w-full items-center gap-2 rounded-md bg-background px-3 py-2 text-left text-xs hover:ring-1 hover:ring-accent/40 disabled:opacity-50"
              >
                <span className="font-semibold">{h.name}</span>
                <span className="truncate text-muted">{h.context}</span>
                <span className="ml-auto shrink-0 text-accent">
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
