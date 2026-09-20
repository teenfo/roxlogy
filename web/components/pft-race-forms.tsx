"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import type { DictKey } from "@/lib/i18n/dictionaries/en";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Choice, Field, Hint, Panel, Segments } from "@/components/rox/ui";

/**
 * 레이스 생성 — 시안 racing.tsx 의 PFT(new) "레이스 정보" Panel 그대로 (PORT_PLAN §3-d):
 * Panel[ Field 레이스 이름 · Hint · Go ]. 크루 선택·참가 방식은 우리 입력이라 Field·Segments 로 더한다.
 * 전체 관리자, 또는 크루 운영진(크루 선택 시).
 */
export function PftRaceCreateForm({ crews }: { crews: { slug: string; name: string }[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [crew, setCrew] = useState(crews[0]?.slug ?? "");
  // 참가 방식 — 코드로 스스로 참가 vs 운영진이 추가(코드 없음)
  const [joinOpen, setJoinOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("pft_race_create", {
      p_title: title.trim(),
      p_crew_slug: crew || null,
      p_join_open: joinOpen,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    const j = data as { ok?: boolean; code?: string; error?: string };
    if (!j.ok || !j.code) return setErr(t(`pft.race.err.${j.error ?? "unknown"}` as DictKey));
    router.push(`/pft/race/${j.code}`);
  }

  return (
    <form onSubmit={submit}>
      <Panel title={t("pft.race.raceInfo")}>
        <Field label={t("pft.race.fldTitle")}>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={80}
            required
            placeholder={t("pft.race.titlePh")}
          />
        </Field>
        <Field label={t("pft.race.fldCrew")}>
          <Choice
            label={t("pft.race.fldCrew")}
            value={crew || "none"}
            onChange={(v) => setCrew(v === "none" ? "" : v)}
            options={[
              ["none", t("pft.race.noCrew")],
              ...crews.map((c) => [c.slug, c.name] as [string, string]),
            ]}
          />
        </Field>
        <Field label={t("pft.race.fldJoinMode")}>
          <Segments
            label={t("pft.race.fldJoinMode")}
            value={joinOpen ? "code" : "staff"}
            onChange={(v) => setJoinOpen(v === "code")}
            options={[
              ["code", t("pft.race.joinModeCode")],
              ["staff", t("pft.race.joinModeStaff")],
            ]}
          />
        </Field>
        <Hint>{t(joinOpen ? "pft.race.joinModeCodeHint" : "pft.race.joinModeStaffHint")}</Hint>
        {err && (
          <p role="alert" className="rx-error">
            {err}
          </p>
        )}
        <Button className="rx-primary" type="submit" disabled={busy || !title.trim()}>
          {busy ? t("common.saving") : t("pft.race.create")}
        </Button>
      </Panel>
    </form>
  );
}
