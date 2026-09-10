"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import type { CrewDirectoryRow } from "@/lib/crew-types";
import type { DictKey } from "@/lib/i18n/dictionaries/en";
import { Avatar, AvatarStack, Chip } from "@/components/ui/crew-ui";

/** 지역 칩용 키 — 위치의 첫 토큰("서울 강남" → "서울"). 크루에 지역 필드가
 *  따로 없어 위치에서 뽑는다. 비어 있으면 묶지 않는다. */
function regionOf(location: string | null): string | null {
  const first = (location ?? "").trim().split(/[\s,·]/)[0];
  return first || null;
}

/** 마지막 활동까지 며칠 */
function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return ms < 0 ? 0 : Math.floor(ms / 86400000);
}

const POLICY_KEY = {
  open: "crew.policyOpen",
  approval: "crew.policyApproval",
  invite: "crew.policyInvite",
} as const satisfies Record<string, DictKey>;

const JOIN_TONE: Record<string, string> = {
  open: "bg-success-bg text-success",
  approval: "bg-label-bg text-label",
  invite: "bg-line text-muted",
};

/** 크루 찾기 — 지역 칩 + 검색(AND, 즉시 반영) */
export function CrewFinder({ crews }: { crews: CrewDirectoryRow[] }) {
  const { t } = useI18n();
  const [region, setRegion] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const regions = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of crews) {
      const r = regionOf(c.location);
      if (r) m.set(r, (m.get(r) ?? 0) + 1);
    }
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [crews]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return crews.filter((c) => {
      if (region && regionOf(c.location) !== region) return false;
      if (!needle) return true;
      return [c.name, c.location, c.tagline, c.description]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(needle));
    });
  }, [crews, region, q]);

  const activityLabel = (d: number | null) => {
    if (d == null) return null;
    return d === 0 ? t("crew.activeToday") : t("crew.activeDaysAgo", { n: d });
  };
  const dotColor = (d: number | null) =>
    d == null ? "bg-muted/40" : d <= 3 ? "bg-success" : d <= 7 ? "bg-accent" : "bg-muted/40";

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">{t("crew.findCrew")}</span>
        <Chip active={!region} count={crews.length} onClick={() => setRegion(null)}>
          {t("crew.all")}
        </Chip>
        {regions.map(([r, n]) => (
          <Chip
            key={r}
            active={region === r}
            count={n}
            onClick={() => setRegion(region === r ? null : r)}
          >
            {r}
          </Chip>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("crew.findPh")}
          aria-label={t("crew.findCrew")}
          className="ml-auto h-9 w-full max-w-56 rounded-lg border border-line-mid bg-card px-3 text-[13px] outline-none focus:border-accent"
        />
      </div>

      {!shown.length ? (
        <div className="mt-4 rounded-2xl border border-dashed border-line-strong px-5 py-12 text-center">
          <p className="text-base font-bold">{t("crew.findEmpty")}</p>
          <p className="mt-1 text-sm text-muted">{t("crew.findEmptyHint")}</p>
          <Link
            href="/crews/new"
            className="mt-4 inline-block rounded-lg border border-line-accent bg-highlight px-5 py-2.5 text-sm font-bold text-accent"
          >
            + {t("crew.createCta")}
          </Link>
        </div>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {shown.map((c) => {
            const d = daysSince(c.last_active_at);
            return (
              <li key={c.slug}>
                <Link
                  href={`/crews/${c.slug}`}
                  className="flex h-full flex-col gap-3.5 rounded-2xl border border-line bg-card px-5 py-4 transition-colors hover:border-line-strong hover:bg-card-hover"
                >
                  <div className="flex items-start gap-3">
                    {c.logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.logo_url}
                        alt=""
                        className="h-12 w-12 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <Avatar name={c.name} size={48} />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[18px] font-extrabold">
                          {c.name}
                        </span>
                        <span
                          className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold ${JOIN_TONE[c.join_policy] ?? JOIN_TONE.invite}`}
                        >
                          {t(POLICY_KEY[c.join_policy])}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[13px] text-muted">
                        {[c.location, c.tagline].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </div>

                  {c.description && (
                    <p className="line-clamp-2 text-sm leading-relaxed text-foreground/75">
                      {c.description}
                    </p>
                  )}

                  <div className="mt-auto flex items-center gap-2 border-t border-line pt-3 text-[13px] text-muted">
                    <span>
                      <b className="font-bold text-foreground">
                        {c.member_count}
                      </b>{" "}
                      {t("crew.members")}
                    </span>
                    <span>
                      <b className="font-bold text-foreground">
                        {c.post_count}
                      </b>{" "}
                      {t("crew.posts")}
                    </span>
                    {d != null && (
                      <span className="flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className={`h-1.5 w-1.5 rounded-full ${dotColor(d)}`}
                        />
                        {activityLabel(d)}
                      </span>
                    )}
                    <span className="ml-auto">
                      <AvatarStack names={c.member_names} max={3} size={22} />
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
