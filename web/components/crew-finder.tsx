"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, MapPin, Users } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import type { CrewDirectoryRow, MyCrewRow } from "@/lib/crew-types";
import { crewInitials } from "@/lib/crew-types";
import type { DictKey } from "@/lib/i18n/dictionaries/en";
import { Chip, Empty, Find, Go, Panel, Segments } from "@/components/rox/ui";

/** 지역 칩용 키 — 위치의 첫 토큰("서울 강남" → "서울"). 크루에 지역 필드가
 *  따로 없어 위치에서 뽑는다. 비어 있으면 묶지 않는다. */
function regionOf(location: string | null): string | null {
  const first = (location ?? "").trim().split(/[\s,·]/)[0];
  return first || null;
}

const POLICY_KEY = {
  open: "crew.policyOpen",
  approval: "crew.policyApproval",
  invite: "crew.policyInvite",
} as const satisfies Record<string, DictKey>;

/** 크루 카드 아트 — 시안 .rx-crew-art 의 "LOOP / 8" 두 줄을 이름 앞글자와 나머지로 만든다 */
function artParts(name: string): [string, string] {
  const compact = name.replace(/\s+/g, "");
  const m = compact.match(/^(.*?)(\d+)$/);
  if (m && m[1]) return [m[1].toUpperCase(), m[2]];
  return [compact.slice(0, 4).toUpperCase(), crewInitials(name).slice(0, 1)];
}

/**
 * 크루 찾기 — 시안 crew.tsx Crews() 그대로 (PORT_PLAN §3-e):
 * Panel(Find) · .rx-crew-discover 카드(아트 · Chip · 이름 · 소개 · 위치·인원 · 화살표) · Empty.
 * 지역 칩(Segments)은 우리 필터 — Panel 안에 Find 와 같이 둔다(§4).
 */
export function CrewFinder({
  crews,
  mine,
  loggedIn,
}: {
  crews: CrewDirectoryRow[];
  mine: MyCrewRow[];
  loggedIn: boolean;
}) {
  const { t } = useI18n();
  const [region, setRegion] = useState("all");
  const [q, setQ] = useState("");

  const regions = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of crews) {
      const r = regionOf(c.location);
      if (r) m.set(r, (m.get(r) ?? 0) + 1);
    }
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [crews]);

  const mineSlugs = new Set(mine.map((c) => c.slug));
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return crews.filter((c) => {
      if (region !== "all" && regionOf(c.location) !== region) return false;
      if (!needle) return true;
      return [c.name, c.location, c.tagline, c.description]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(needle));
    });
  }, [crews, region, q]);

  // 내 크루를 앞에 — 시안은 "가입한 크루" 칩이 붙은 카드가 첫 번째다
  const ordered = [...shown].sort(
    (a, b) => Number(mineSlugs.has(b.slug)) - Number(mineSlugs.has(a.slug)),
  );

  return (
    <>
      <Panel>
        <div className="rx-toolbar">
          <Find value={q} onChange={setQ} placeholder={t("crew.findPh")} />
          {regions.length > 0 && (
            <Segments
              label={t("crew.findCrew")}
              value={region}
              onChange={setRegion}
              options={[["all", t("crew.all")], ...regions.map(([r, n]) => [r, `${r} ${n}`] as [string, string])]}
            />
          )}
        </div>
      </Panel>
      {ordered.length ? (
        ordered.map((c) => {
          const [word, num] = artParts(c.name);
          const isMine = mineSlugs.has(c.slug);
          return (
            <Link className="rx-crew-discover" key={c.slug} href={`/crews/${c.slug}`}>
              <div className={`rx-crew-art ${num.length > 2 ? "small" : ""}`}>
                {c.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.logo_url} alt="" style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 24 }} />
                ) : (
                  <span>
                    {word}
                    <b>{num}</b>
                  </span>
                )}
                <div>{(c.tagline || t("landing.tagline")).toUpperCase()}</div>
              </div>
              <section>
                <div className="rx-actions">
                  {isMine ? (
                    <Chip tone="green">{t("crew.joinedBadge")}</Chip>
                  ) : (
                    <Chip>{t(POLICY_KEY[c.join_policy] ?? POLICY_KEY.invite)}</Chip>
                  )}
                </div>
                <h2>{c.name}</h2>
                <p>{c.description || c.tagline || "—"}</p>
                <div>
                  {c.location && (
                    <span>
                      <MapPin size={16} />
                      {c.location}
                    </span>
                  )}
                  <span>
                    <Users size={16} />
                    {c.member_count} 
                    {t("crew.members")}
                  </span>
                  <ArrowRight size={23} />
                </div>
              </section>
            </Link>
          );
        })
      ) : (
        <Empty
          title={t("crew.findEmpty")}
          description={t("crew.findEmptyHint")}
          action={<Go href={loggedIn ? "/crews/new" : "/login?next=%2Fcrews%2Fnew"}>{t("crew.createCta")}</Go>}
        />
      )}
    </>
  );
}
