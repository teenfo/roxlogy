"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { formatDateShortYear } from "@/lib/format";
import type { DictKey } from "@/lib/i18n/dictionaries/en";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Chip, Field, Hint, Panel } from "@/components/rox/ui";

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

/**
 * 레이스 참가 — 시안 racing.tsx 의 PFT(join) "참가 코드" Panel 그대로 (PORT_PLAN §3-d):
 * Panel[ Field 6자리 코드 · Hint · 버튼 ]. "지금 참가할 수 있는 레이스" 목록은 우리 기능이라
 * 시안 스태프 화면의 멤버 행(.rx-pft-member)으로 위에 얹는다(§4-1).
 */
export function PftRacePick({
  races,
  locale = "en-US",
  tz,
  blocked = false,
}: {
  races: JoinableRace[];
  locale?: string;
  tz?: string;
  /** 프로필 필수값(출생연도·성별)이 비어 참가를 막아야 하는가 — 안내는 위에서 따로 띄운다 */
  blocked?: boolean;
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
    <>
      {err && (
        <p role="alert" className="rx-error">
          {err}
        </p>
      )}

      <Panel title={t("pft.race.pickTitle")} action={<Chip>{races.length}</Chip>}>
        {races.length === 0 ? (
          <p className="rx-pft-small-empty">{t("pft.race.pickEmpty")}</p>
        ) : (
          <div className="rx-pft-member-results">
            {races.map((r) => (
              <div className="rx-pft-member" key={r.id}>
                <span className="rx-avatar">{r.title.slice(0, 1)}</span>
                <span>
                  <b>{r.title}</b>
                  <small>
                    {formatDateShortYear(r.created_at, locale, tz)}
                    {r.crew && ` · ${r.crew}`}
                    {` · ${t("pft.race.pickEntries", { n: r.entries })}`}
                  </small>
                </span>
                <Button
                  variant={r.joined ? "outline" : "default"}
                  className={r.joined ? "" : "rx-primary"}
                  size="sm"
                  type="button"
                  onClick={() => joinByCode(r.code)}
                  disabled={busy !== null || (blocked && !r.joined)}
                  aria-label={`${r.title} ${t("pft.race.pickJoin")}`}
                >
                  {busy === r.code ? (
                    t("common.saving")
                  ) : r.joined ? (
                    t("pft.race.linkMine")
                  ) : (
                    <>
                      <Plus size={15} />
                      {t("pft.race.pickJoin")}
                    </>
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* 코드로 참가 — 목록에 없는 레이스용 */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const c = code.trim().toUpperCase();
          if (c.length !== 6) return setErr(t("pft.race.err.race_not_found"));
          void joinByCode(c);
        }}
      >
        <Panel title={t("pft.race.joinByCode")}>
          <Field label={t("pft.race.joinCode6")}>
            <Input
              value={code}
              onChange={(e) =>
                setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))
              }
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              placeholder="ABC123"
            />
          </Field>
          <Hint>{t("pft.race.pickByCodeHint")}</Hint>
          <Button
            type="submit"
            variant="outline"
            disabled={busy !== null || blocked || code.length !== 6}
          >
            {t("pft.race.join")}
          </Button>
        </Panel>
      </form>
    </>
  );
}
