"use client";

import Link from "next/link";
import { useI18n } from "@/components/i18n-provider";
import { Avatar } from "@/components/ui/crew-ui";

export type TickerCrew = {
  slug: string;
  name: string;
  logoUrl: string | null;
  location: string | null;
  memberCount: number;
  /** 마지막 활동이 며칠 전인지. null 이면 활동 기록 없음 */
  daysAgo: number | null;
};

/**
 * 랜딩 "지금 활동 중인 크루" 티커.
 *
 * 목록을 두 번 그려 절반만큼 올리는 CSS 애니메이션으로 무한 루프를 만든다.
 * hover 하면 멈추고(읽을 시간을 준다), 모션 감소 설정과 항목이 적을 때는
 * 아예 흐르지 않는 정적 목록으로 떨어진다 — 애니메이션은 CSS 클래스로만
 * 걸어 두어 JS 가 없어도 SSR 마크업이 그대로 유효하다.
 */
export function LandingCrewTicker({ crews }: { crews: TickerCrew[] }) {
  const { t } = useI18n();
  if (!crews.length) return null;

  // 4개 미만이면 복제해도 빈 틈이 눈에 띈다 — 정적으로 둔다.
  const scroll = crews.length >= 4;

  const row = (c: TickerCrew, clone: boolean) => (
    <li key={`${c.slug}-${clone ? "b" : "a"}`}>
      <Link
        href={`/crews/${c.slug}`}
        aria-hidden={clone || undefined}
        tabIndex={clone ? -1 : undefined}
        className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-line-mid bg-card px-3.5 py-3 transition-colors duration-100 hover:border-line-strong hover:bg-card-hover"
      >
        {c.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={c.logoUrl}
            alt=""
            className="h-10 w-10 shrink-0 rounded-full object-cover"
          />
        ) : (
          <Avatar name={c.name} size={40} />
        )}
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-extrabold">
            {c.name}
          </span>
          {c.location && (
            <span className="block truncate text-xs text-muted">
              {c.location}
            </span>
          )}
        </span>
        <span className="shrink-0 text-right">
          <span className="tabular block text-sm font-bold">
            {t("landing.crewMembers", { n: c.memberCount })}
          </span>
          <span
            className={`flex items-center justify-end gap-1 text-xs ${
              c.daysAgo === 0 ? "text-success" : "text-muted"
            }`}
          >
            <span
              aria-hidden
              className={`h-[5px] w-[5px] rounded-full ${
                c.daysAgo === 0 ? "bg-success" : "bg-line-strong"
              }`}
            />
            {c.daysAgo === 0
              ? t("landing.crewActiveToday")
              : c.daysAgo == null
                ? "—"
                : t("landing.crewActiveAgo", { n: c.daysAgo })}
          </span>
        </span>
      </Link>
    </li>
  );

  return (
    <div
      className={`crew-ticker-wrap relative overflow-hidden rounded-xl ${
        // 흐르지 않을 때까지 340px 를 잡으면 크루가 한둘일 때 빈 상자가 된다
        scroll ? "h-[340px] max-md:h-[260px]" : "max-h-[340px]"
      }`}
    >
      {/* 위·아래 페이드 — 잘린 행이 갑자기 사라지지 않게 */}
      {scroll && (
        <>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 z-[2] h-14 bg-gradient-to-b from-highlight to-transparent"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-14 bg-gradient-to-t from-highlight to-transparent"
          />
        </>
      )}
      <span className="absolute right-0 top-2.5 z-[3] flex items-center gap-1.5 text-xs font-bold tracking-[0.06em] text-[#8a7a2a]">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success" />
        {t("landing.activeCrews")}
      </span>

      <ul
        className={`flex flex-col gap-2 ${scroll ? "crew-ticker" : "pt-7"}`}
        style={
          scroll
            ? ({
                "--crew-scroll-speed": `${crews.length * 3.5}s`,
              } as React.CSSProperties)
            : undefined
        }
      >
        {crews.map((c) => row(c, false))}
        {scroll && crews.map((c) => row(c, true))}
      </ul>
    </div>
  );
}
