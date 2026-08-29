"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

const input =
  "w-full rounded-md border border-muted/30 bg-background px-3 py-2 text-sm outline-none focus:border-accent";

export type DuesAudience = "all" | "member" | "associate";

export type DuesLink = {
  id: string;
  label: string;
  url: string;
  audience: DuesAudience;
};

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
  const [audience, setAudience] = useState<DuesAudience>("all");
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

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !/^https?:\/\//i.test(url.trim())) return;
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase.from("crew_dues_links").insert({
      crew_id: crewId,
      label: label.trim(),
      url: url.trim(),
      audience,
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setLabel("");
    setUrl("");
    setAudience("all");
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

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted">{t("crew.duesHint")}</p>

      {items.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {items.map((l) => (
            <li
              key={l.id}
              className="flex min-w-0 items-center gap-2 rounded-md bg-surface px-3 py-2.5"
            >
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${audBadge[l.audience]}`}
              >
                {audLabel[l.audience]}
              </span>
              <span className="shrink-0 text-sm font-semibold">{l.label}</span>
              <a
                href={l.url}
                target="_blank"
                rel="noreferrer noopener"
                className="min-w-0 flex-1 truncate text-xs text-accent hover:underline"
              >
                {l.url}
              </a>
              <button
                type="button"
                onClick={() => del(l.id)}
                disabled={busy}
                className="shrink-0 text-muted hover:text-red-400 disabled:opacity-50"
                aria-label={t("common.delete")}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="flex flex-col gap-2 rounded-md bg-surface p-4">
        <input
          className={input}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t("crew.duesLabelPh")}
          maxLength={60}
        />
        <input
          className={input}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t("crew.duesUrlPh")}
          maxLength={500}
          inputMode="url"
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">{t("crew.duesAudience")}</span>
          {(["all", "member", "associate"] as const).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAudience(a)}
              className={`rounded-full px-3 py-1 text-xs ${
                audience === a
                  ? "bg-accent font-bold text-background"
                  : "bg-background text-muted hover:text-foreground"
              }`}
            >
              {audLabel[a]}
            </button>
          ))}
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <div>
          <button
            type="submit"
            disabled={busy || !label.trim() || !/^https?:\/\//i.test(url.trim())}
            className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-background disabled:opacity-40"
          >
            + {t("crew.duesAdd")}
          </button>
        </div>
      </form>
    </div>
  );
}
