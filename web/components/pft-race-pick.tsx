"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { formatDateShortYear } from "@/lib/format";
import type { DictKey } from "@/lib/i18n/dictionaries/en";

/** 지금 참가할 수 있는 레이스 한 줄 (pft_race_joinable) */
export type JoinableRace = {
  id: string;
  code: string;
  title: string;
  created_at: string;
  crew: string | null;
  crew_slug: string | null;
  entries: number;
  joined: boolean;
};

const INPUT =
  "h-11 w-full rounded-lg border border-line-strong bg-page px-3 text-sm outline-none focus:border-accent";

/**
 * 레이스 참가 — 먼저 "지금 참가할 수 있는 레이스"를 보여 주고 골라서 참가한다.
 * 코드 입력은 목록에 없는 레이스(남의 크루 행사 등)를 위해 아래에 남긴다.
 */
export function PftRacePick({
  races,
  locale = "en-US",
  tz,
}: {
  races: JoinableRace[];
  locale?: string;
  tz?: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [code, setCode] = useState("");

  async function joinByCode(c: string) {
    setBusy(c);
    setErr(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("pft_race_join", { p_code: c });
    setBusy(null);
    if (error) return setErr(error.message);
    const j = data as { ok?: boolean; code?: string; error?: string };
    if (!j?.ok) return setErr(t(`pft.race.err.${j?.error ?? "unknown"}` as DictKey));
    router.push(`/pft/race/${j.code ?? c}`);
  }

  return (
    <div className="flex flex-col gap-4">
      {err && (
        <p role="alert" className="text-sm text-danger">
          {err}
        </p>
      )}

      {/* 참가 가능한 레이스 */}
      <section className="flex flex-col gap-2">
        <p className="text-sm font-bold">
          {t("pft.race.pickTitle")} <span className="tabular text-muted">{races.length}</span>
        </p>
        {races.length === 0 ? (
          <p className="rounded-2xl border border-line bg-card px-4 py-8 text-center text-sm text-muted">
            {t("pft.race.pickEmpty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {races.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-line bg-card p-4"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-base font-extrabold">{r.title}</span>
                    {r.joined && (
                      <span className="rounded-md bg-success-bg px-2 py-0.5 text-[11px] font-bold text-success">
                        {t("pft.race.staffJoined")}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted">
                    {formatDateShortYear(r.created_at, locale, tz)}
                    {r.crew && ` · ${r.crew}`}
                    {` · ${t("pft.race.pickEntries", { n: r.entries })}`}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => joinByCode(r.code)}
                  disabled={busy !== null}
                  className={`h-10 shrink-0 rounded-lg px-5 text-sm font-extrabold disabled:opacity-40 ${
                    r.joined
                      ? "border border-line-strong bg-control text-foreground hover:border-muted/60"
                      : "bg-accent text-background hover:brightness-110"
                  }`}
                >
                  {busy === r.code
                    ? t("common.saving")
                    : r.joined
                      ? t("pft.race.linkMine")
                      : t("pft.race.pickJoin")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 코드로 참가 — 목록에 없는 레이스용 */}
      <section className="rounded-2xl border border-line bg-card p-5">
        <p className="text-sm font-bold">{t("pft.race.pickByCode")}</p>
        <p className="mt-1 text-xs text-muted">{t("pft.race.pickByCodeHint")}</p>
        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const c = code.trim().toUpperCase();
            if (c.length !== 6) return setErr(t("pft.race.err.race_not_found"));
            void joinByCode(c);
          }}
        >
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t("pft.race.code")}
            <input
              className={`${INPUT} text-center font-mono text-2xl font-extrabold uppercase tracking-[0.3em]`}
              value={code}
              onChange={(e) =>
                setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))
              }
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              placeholder="ABC123"
            />
          </label>
          <button
            type="submit"
            disabled={busy !== null || code.length !== 6}
            className="h-11 rounded-lg border border-line-strong bg-control text-sm font-extrabold hover:border-muted/60 disabled:opacity-40"
          >
            {t("pft.race.join")}
          </button>
        </form>
      </section>
    </div>
  );
}
