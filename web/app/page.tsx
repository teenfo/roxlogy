import Image from "next/image";
import Link from "next/link";
import { getCrewDirectory } from "@/lib/crew";
import { getT } from "@/lib/i18n";
import { formatMs, formatDateShort } from "@/lib/format";
import { makeLandingDemo } from "@/lib/landing-demo";
import { CHART_COLORS } from "@/lib/hyrox";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Avatar, AvatarStack } from "@/components/ui/crew-ui";
import type { DictKey } from "@/lib/i18n/dictionaries/en";

const sec = (s: number) => formatMs(s * 1000);

const ctaPrimary =
  "flex h-[52px] items-center justify-center rounded-[10px] bg-accent px-7 text-base font-extrabold text-background transition hover:brightness-110";
const ctaGhost =
  "flex h-[52px] items-center justify-center rounded-[10px] border border-line-strong px-7 text-[15px] font-semibold transition-colors hover:border-[#555]";

export default async function Landing() {
  // 크루 카드는 공개 RPC(crew_directory)라 비로그인에서도 그대로 내려온다.
  // 히어로 수치는 요청마다 새로 만드는 가짜 기록이다 — 실사용자 기록이 아니다.
  const [{ t, tag, tz }, crews] = await Promise.all([getT(), getCrewDirectory(3)]);
  const demo = makeLandingDemo();
  const features = [1, 2, 3] as const;

  const pct = (v: number) => (v / demo.finish) * 100;
  const lead = crews[0] ?? null;

  return (
    <main className="flex flex-1 flex-col">
      {/* 0. 상단 바 — 랜딩 전용(비로그인). 로그인 후 글로벌 네비와 별개다 */}
      <header className="sticky top-0 z-40 border-b border-line-soft bg-[color-mix(in_srgb,var(--page)_85%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex h-[60px] max-w-[1120px] items-center justify-between gap-3 px-6 max-md:px-4">
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            <Image
              src="/roxlogy-mark.svg"
              alt="Roxlogy"
              width={30}
              height={30}
              priority
            />
            <span className="text-[17px] font-extrabold tracking-[0.08em]">
              ROXLOGY
            </span>
          </Link>

          <div className="flex shrink-0 items-center gap-2">
            <LocaleSwitcher compact />
            {/* 모바일은 자리가 빠듯해 시작하기 하나만 남긴다 */}
            <Link
              href="/login"
              className="hidden h-9 items-center rounded-lg border border-line-strong px-4 text-[13px] font-semibold transition-colors hover:border-[#555] md:flex"
            >
              {t("common.login")}
            </Link>
            <Link
              href="/signup"
              className="flex h-9 items-center rounded-lg bg-accent px-4 text-[13px] font-extrabold text-background transition hover:brightness-110"
            >
              {t("landing.startCta")}
            </Link>
          </div>
        </div>
      </header>

      {/* 1. 히어로 */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 h-[600px] w-[900px] max-w-none -translate-x-1/2"
          style={{
            background:
              "radial-gradient(ellipse, rgba(255,214,10,.10) 0%, transparent 60%)",
          }}
        />
        <div className="relative mx-auto grid w-full max-w-[1120px] items-center gap-14 px-6 pb-[72px] pt-24 max-md:gap-8 max-md:px-5 max-md:pb-10 max-md:pt-14 md:grid-cols-[1.1fr_0.9fr]">
          <div className="flex flex-col gap-6">
            <h1 className="text-[clamp(2.375rem,5.2vw,3.75rem)] font-black leading-[1.05] tracking-[-0.03em] [text-wrap:balance] [word-break:keep-all]">
              {t("landing.h1a")}{" "}
              <span className="text-accent">{t("landing.h1b")}</span>{" "}
              {t("landing.h1c")}
            </h1>

            <p className="max-w-[460px] text-lg leading-relaxed text-foreground/80 [word-break:keep-all] max-md:text-base">
              {t("landing.heroSub")}
            </p>

            <div className="flex flex-wrap gap-2.5 max-md:flex-col">
              <Link href="/signup" className={`${ctaPrimary} max-md:w-full`}>
                {t("landing.startFree")}
              </Link>
              <Link href="/login" className={`${ctaGhost} max-md:w-full`}>
                {t("common.login")}
              </Link>
            </div>

            {/* 앱 다운로드는 아직 미출시라 랜딩에 노출하지 않는다 */}
            <div className="flex flex-wrap gap-x-5 gap-y-2.5 text-sm font-semibold text-accent">
              <Link href="/predict" className="hover:underline">
                {t("landing.predictLink")}
              </Link>
              <Link href="/events" className="hover:underline">
                {t("landing.eventsLink")}
              </Link>
              <Link href="/crews" className="hover:underline">
                {t("landing.crewsLink")}
              </Link>
            </div>
          </div>

          {/* 분석 카드 — 전부 가짜 수치 */}
          <div className="flex flex-col gap-[18px] rounded-[18px] border border-line-mid bg-card p-[22px] shadow-[0_30px_80px_rgba(0,0,0,.6)]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-[5px] bg-accent/15 px-[7px] py-[3px] text-[11px] font-bold text-accent-dim">
                {t("landing.demoRace")}
              </span>
              <span className="rounded-[5px] bg-label-bg px-[7px] py-[3px] text-[11px] font-bold tracking-[0.04em] text-label">
                {demo.division}
              </span>
              <span className="ml-auto rounded-[5px] bg-label-bg px-[7px] py-[3px] text-[10px] font-bold text-label">
                {t("landing.sampleData")}
              </span>
            </div>

            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xl font-extrabold">
                  {t("landing.demoRaceName")}
                </p>
                <p className="mt-0.5 text-[13px] text-muted">
                  {formatDateShort(demo.racedOn, tag, tz)}
                </p>
              </div>
              <div className="text-right">
                <p className="tabular text-[40px] font-extrabold leading-none tracking-[-0.02em] text-accent max-md:text-[32px]">
                  {sec(demo.finish)}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {t("landing.percentile", { n: demo.percentile })}
                </p>
              </div>
            </div>

            {/* 시간 구성 */}
            <div>
              <div className="flex flex-wrap justify-between gap-x-3 text-xs text-muted">
                <span>{t("landing.timeMix")}</span>
                <span>
                  {t("landing.m.run")} {Math.round(pct(demo.runTotal))}% ·{" "}
                  {t("landing.m.station")} {Math.round(pct(demo.stationTotal))}% ·{" "}
                  {t("landing.m.roxzone")} {Math.round(pct(demo.roxTotal))}%
                </span>
              </div>
              <div className="mt-2 flex h-3 gap-0.5 overflow-hidden rounded-md">
                {[
                  { v: demo.runTotal, c: CHART_COLORS.run },
                  { v: demo.stationTotal, c: CHART_COLORS.station },
                  { v: demo.roxTotal, c: CHART_COLORS.roxzone },
                ].map((p, i) => (
                  <span
                    key={i}
                    className="block h-full"
                    style={{ width: `${pct(p.v)}%`, background: p.c }}
                  />
                ))}
              </div>
            </div>

            {/* AI 코칭 */}
            <div className="rounded-[10px] border border-line-strong border-l-[3px] border-l-accent bg-page px-3.5 py-3">
              <p className="text-[11px] font-extrabold tracking-[0.08em] text-accent">
                {t("landing.aiLabel")}
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-foreground/85 [word-break:keep-all]">
                {t("landing.aiChip", {
                  station: t(`station.${demo.slowest.key}` as DictKey),
                  sec: sec(demo.slowest.sec),
                  rox: sec(demo.roxTotal),
                })}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 2. 기능 3카드 */}
      <section className="mx-auto grid w-full max-w-[1120px] gap-3 px-6 pb-20 pt-4 max-md:px-5 max-md:pb-12 md:grid-cols-3">
        {features.map((n) => (
          <div
            key={n}
            className="flex flex-col gap-2.5 rounded-2xl border border-line bg-card p-6"
          >
            <span
              aria-hidden
              className="flex h-10 w-10 items-center justify-center rounded-[10px] text-lg"
              style={{
                background: ["var(--info-bg)", "#2a2500", "var(--success-bg)"][n - 1],
                color: [CHART_COLORS.run, "var(--accent-dim)", "var(--success)"][n - 1],
              }}
            >
              {["▶", "◔", "⚑"][n - 1]}
            </span>
            <h2 className="text-lg font-extrabold">
              {t(`landing.feature${n}.title`)}
            </h2>
            <p className="text-sm leading-relaxed text-muted [word-break:keep-all]">
              {t(`landing.feature${n}.body`)}
            </p>
          </div>
        ))}
      </section>

      {/* 3. 크루 배너 — 수치는 실제 공개 크루 것이다 (가짜 모임을 만들지 않는다) */}
      {lead && (
        <section className="mx-auto w-full max-w-[1120px] px-6 pb-20 max-md:px-5 max-md:pb-12">
          <div className="grid items-center gap-6 rounded-2xl border border-line-accent bg-highlight px-7 py-6 max-md:grid-cols-1 max-md:px-5 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="flex min-w-0 flex-col gap-2.5">
              <p className="text-xs font-extrabold tracking-[0.1em] text-accent">
                CREW
              </p>
              <h2 className="text-xl font-extrabold [word-break:keep-all]">
                {t("landing.crewsTitle")}
              </h2>
              <p className="max-w-[560px] text-sm text-foreground/80 [word-break:keep-all]">
                {t("landing.crewsSub")}
              </p>
              <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-2 text-[13px]">
                {lead.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={lead.logo_url}
                    alt=""
                    className="h-[22px] w-[22px] shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <Avatar name={lead.name} size={22} />
                )}
                <Link
                  href={`/crews/${lead.slug}`}
                  className="font-bold text-accent hover:underline"
                >
                  {lead.name}
                </Link>
                <span className="text-foreground/85">
                  {lead.location ? `${lead.location} · ` : ""}
                  {lead.member_count} {t("crew.members")}
                </span>
                <AvatarStack names={lead.member_names} max={3} />
              </p>
            </div>

            <Link
              href="/crews"
              className="flex h-11 shrink-0 items-center justify-center rounded-[10px] border border-line-accent px-5 text-sm font-bold text-accent transition-colors hover:border-[#8a7a2a] hover:bg-[#1f1c10] max-md:w-full"
            >
              {t("landing.crewsAll")}
            </Link>
          </div>
        </section>
      )}

      {/* 4. 최종 CTA */}
      <section className="border-t border-line-soft">
        <div className="mx-auto flex w-full max-w-[1120px] flex-col items-center gap-[18px] px-6 pb-[88px] pt-[72px] text-center max-md:px-5 max-md:pb-14 max-md:pt-14">
          <h2 className="text-4xl font-black leading-tight tracking-[-0.03em] [text-wrap:balance] [word-break:keep-all] max-md:text-[30px]">
            {t("landing.ctaTitle")}
          </h2>
          <p className="text-base text-muted [word-break:keep-all]">
            {t("landing.ctaSub")}
          </p>
          <Link href="/signup" className={`${ctaPrimary} max-md:w-full`}>
            {t("landing.startFree")}
          </Link>
        </div>
      </section>

      {/* 5. 푸터 */}
      <footer className="border-t border-line-soft">
        <div className="mx-auto flex w-full max-w-[1120px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6 py-6 text-[13px] text-muted max-md:flex-col max-md:items-start max-md:px-5">
          <span className="flex items-center gap-2">
            <Image src="/roxlogy-mark.svg" alt="" width={20} height={20} />
            <span className="font-extrabold tracking-[0.08em] text-foreground/80">
              ROXLOGY
            </span>
            <span className="max-sm:hidden">· {t("landing.tagline")}</span>
          </span>
          <span className="flex flex-wrap gap-x-[18px] gap-y-2">
            <Link href="/predict" className="hover:text-foreground">
              {t("nav.predict")}
            </Link>
            <Link href="/events" className="hover:text-foreground">
              {t("nav.events")}
            </Link>
            <Link href="/crews" className="hover:text-foreground">
              {t("nav.crews")}
            </Link>
          </span>
        </div>
      </footer>
    </main>
  );
}
