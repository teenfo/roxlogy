import Image from "next/image";
import Link from "next/link";
import { getCrewDirectory } from "@/lib/crew";
import { getT } from "@/lib/i18n";
import { formatMs } from "@/lib/format";
import { makeLandingDemo } from "@/lib/landing-demo";
import { CHART_COLORS } from "@/lib/hyrox";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { LandingPreview } from "@/components/landing-preview";
import { Avatar, AvatarStack } from "@/components/ui/crew-ui";
import type { DictKey } from "@/lib/i18n/dictionaries/en";

const sec = (s: number) => formatMs(s * 1000);

const ctaPrimary =
  "flex h-[52px] items-center justify-center rounded-[10px] bg-accent px-6 text-base font-extrabold text-background transition hover:brightness-110";
const ctaGhost =
  "flex h-[52px] items-center justify-center rounded-[10px] border border-line-strong px-6 text-[15px] font-semibold transition-colors hover:border-[#555]";

export default async function Landing() {
  // 크루 목록은 공개 RPC(crew_directory)라 비로그인에서도 그대로 내려온다.
  // 미리보기 수치는 요청마다 새로 만드는 가짜 데이터다 — 실사용자 기록이 아니다.
  const [{ t }, crews] = await Promise.all([getT(), getCrewDirectory(6)]);
  const demo = makeLandingDemo();
  const features = [1, 2, 3] as const;

  const total = demo.finish;
  const pct = (v: number) => (v / total) * 100;
  const laps = demo.rounds.map((r) => r.run);
  const lapMin = Math.min(...laps);
  const lapMax = Math.max(...laps);
  // 랩 추이 폴리라인 (viewBox 100×36)
  const points = laps
    .map((v, i) => {
      const x = (i / (laps.length - 1)) * 100;
      const y =
        lapMax === lapMin ? 18 : 32 - ((v - lapMin) / (lapMax - lapMin)) * 28;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const [lead, ...rest] = crews;

  const navLinks: { href: string; label: DictKey }[] = [
    { href: "#how", label: "landing.navHow" },
    { href: "#preview", label: "landing.navPreview" },
    { href: "#crew", label: "landing.navCrew" },
    { href: "/events", label: "landing.navEvents" },
  ];

  return (
    <main className="flex flex-1 flex-col">
      {/* 0. 상단 바 — 랜딩 전용(비로그인). 로그인 후 글로벌 네비와 별개다 */}
      <header className="sticky top-0 z-40 border-b border-line-soft bg-[color-mix(in_srgb,var(--page)_85%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex h-[60px] max-w-[1120px] items-center gap-3 px-6 max-md:px-4">
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

          <nav className="mx-auto hidden items-center gap-[22px] md:flex">
            {navLinks.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="text-sm font-semibold text-foreground/75 transition-colors hover:text-foreground"
              >
                {t(l.label)}
              </a>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-2 md:ml-0">
            <LocaleSwitcher compact />
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
        <div className="relative mx-auto grid w-full max-w-[1120px] items-center gap-12 px-6 pb-16 pt-[88px] max-md:gap-8 max-md:px-5 max-md:pb-10 max-md:pt-14 md:grid-cols-2">
          <div className="flex flex-col gap-[22px]">
            <span className="flex h-[30px] w-fit items-center gap-1.5 rounded-full border border-line-accent bg-highlight px-3 text-xs font-bold text-accent">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
              {t("landing.heroBadge")}
            </span>

            <h1 className="text-[clamp(2.375rem,5.2vw,3.75rem)] font-black leading-[1.05] tracking-[-0.03em] [text-wrap:balance] [word-break:keep-all]">
              {t("landing.h1a")}{" "}
              <span className="text-accent">{t("landing.h1b")}</span>{" "}
              {t("landing.h1c")}
            </h1>

            <p className="max-w-[480px] text-lg leading-relaxed text-foreground/80 [word-break:keep-all] max-md:text-base">
              {t("landing.heroSub")}
            </p>

            <div className="flex flex-wrap gap-3 max-md:flex-col">
              <Link href="/signup" className={`${ctaPrimary} max-md:w-full`}>
                {t("landing.startFree")}
              </Link>
              <Link href="/crews" className={`${ctaGhost} max-md:w-full`}>
                {t("landing.crewsLink")}
              </Link>
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-accent">
              <Link href="/predict" className="hover:underline">
                {t("landing.predictLink")}
              </Link>
              <Link href="/events" className="hover:underline">
                {t("landing.eventsLink")}
              </Link>
            </div>
          </div>

          {/* 히어로 분석 카드 — 전부 가짜 수치 */}
          <div className="relative rounded-[18px] border border-line-mid bg-card p-5 shadow-[0_30px_80px_rgba(0,0,0,.6)]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-[5px] bg-accent/15 px-2 py-[3px] text-[11px] font-bold text-accent-dim">
                {t("landing.demoRace")}
              </span>
              <span className="rounded-[5px] bg-label-bg px-2 py-[3px] text-[11px] font-bold text-label">
                {demo.history[0].division}
              </span>
              <span className="ml-auto rounded-[5px] bg-label-bg px-2 py-[3px] text-[10px] font-bold text-label">
                {t("landing.sampleData")}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xl font-extrabold">
                  {t("landing.demoRaceName")}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {t("landing.percentile", { n: demo.percentile })}
                </p>
              </div>
              <p className="tabular text-[34px] font-extrabold leading-none text-accent">
                {sec(demo.finish)}
              </p>
            </div>

            {/* 시간 구성 스택 */}
            <div className="mt-4">
              <div className="flex justify-between text-[11px] text-muted">
                <span>{t("landing.m.run")} {Math.round(pct(demo.runTotal))}%</span>
                <span>{t("landing.m.station")} {Math.round(pct(demo.stationTotal))}%</span>
                <span>{t("landing.m.roxzone")} {Math.round(pct(demo.roxTotal))}%</span>
              </div>
              <div className="mt-1.5 flex h-3 gap-0.5 overflow-hidden rounded-md">
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

            {/* 런 랩 추이 */}
            <div className="mt-4 rounded-[10px] border border-line bg-page px-3 py-3">
              <svg
                viewBox="0 0 100 36"
                preserveAspectRatio="none"
                className="h-16 w-full"
                role="img"
                aria-label={t("landing.lapTrend")}
              >
                <polyline
                  points={points}
                  fill="none"
                  stroke={CHART_COLORS.run}
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <p className="mt-1 text-[11px] text-muted">
                {t("landing.lapSpread", { d: sec(demo.lapSpread) })}
              </p>
            </div>

            {/* 미니 지표 3칸 */}
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[
                {
                  label: t("landing.m.run"),
                  value: sec(demo.runTotal),
                  color: CHART_COLORS.run,
                },
                {
                  label: t(`station.${demo.slowest.key}` as DictKey),
                  value: sec(demo.slowest.sec),
                  color: CHART_COLORS.station,
                },
                {
                  label: t("landing.m.roxzone"),
                  value: sec(demo.roxTotal),
                  color: CHART_COLORS.roxzone,
                },
              ].map((m) => (
                <div
                  key={m.label}
                  className="min-w-0 rounded-[10px] border border-line bg-page px-2.5 py-2"
                >
                  <p className="truncate text-[10px] text-muted">{m.label}</p>
                  <p
                    className="tabular mt-0.5 text-[15px] font-extrabold"
                    style={{ color: m.color }}
                  >
                    {m.value}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-3 rounded-xl border border-line-accent bg-highlight px-3.5 py-2.5">
              <p className="text-[11px] font-extrabold text-accent">
                {t("landing.aiLabel")}
              </p>
              <p className="mt-0.5 text-[13px] text-foreground/85 [word-break:keep-all]">
                {t("landing.aiChip", { rox: sec(demo.roxTotal) })}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 2. 신뢰 띠 */}
      <section className="mx-auto w-full max-w-[1120px] px-6 max-md:px-4">
        <div className="grid grid-cols-3 gap-4 border-y border-line-soft py-5 text-center">
          {[1, 2, 3].map((n) => (
            <div key={n} className="min-w-0">
              <p
                className={`tabular text-[26px] font-extrabold [word-break:keep-all] max-md:text-[15px] ${n === 1 ? "text-accent" : ""}`}
              >
                {t(`landing.trust${n}.value` as DictKey)}
              </p>
              <p className="mt-1 text-[13px] text-muted [word-break:keep-all]">
                {t(`landing.trust${n}.desc` as DictKey)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* 3. 작동 방식 */}
      <section
        id="how"
        className="mx-auto w-full max-w-[1120px] scroll-mt-[72px] px-6 py-[72px] max-md:px-4 max-md:py-12"
      >
        <p className="text-xs font-extrabold tracking-[0.1em] text-accent">
          HOW IT WORKS
        </p>
        <h2 className="mt-2 text-4xl font-extrabold tracking-tight [word-break:keep-all] max-md:text-[26px]">
          {t("landing.howTitle")}
        </h2>
        <p className="mt-2 text-base text-muted [word-break:keep-all]">
          {t("landing.howSub")}
        </p>

        <div className="mt-9 grid gap-3.5 md:grid-cols-3">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-6"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-sm font-extrabold text-background">
                {n}
              </span>
              <p className="text-xs font-bold tracking-[0.06em] text-muted">
                {t(`landing.step${n}.tag` as DictKey)}
              </p>
              <h3 className="text-xl font-extrabold">
                {t(`landing.step${n}.title` as DictKey)}
              </h3>
              <p className="text-sm leading-relaxed text-muted [word-break:keep-all]">
                {t(`landing.step${n}.body` as DictKey)}
              </p>
              <p className="mt-auto flex items-center gap-2 rounded-[10px] border border-line bg-page px-3.5 py-3 text-[13px]">
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{
                    background: [
                      CHART_COLORS.run,
                      CHART_COLORS.station,
                      "var(--success)",
                    ][n - 1],
                  }}
                />
                <span className="min-w-0 truncate">
                  {t(`landing.step${n}.sample` as DictKey)}
                </span>
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* 4. 분석 화면 미리보기 */}
      <section
        id="preview"
        className="scroll-mt-[72px] border-y border-line-soft bg-inset"
      >
        <div className="mx-auto w-full max-w-[1120px] px-6 py-[72px] max-md:px-4 max-md:py-12">
          <LandingPreview demo={demo} />
        </div>
      </section>

      {/* 5. 기능 3카드 */}
      <section className="mx-auto grid w-full max-w-[1120px] gap-3.5 px-6 py-[72px] max-md:px-4 max-md:py-12 md:grid-cols-3">
        {features.map((n) => (
          <div key={n} className="rounded-2xl border border-line bg-card p-6">
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
            <h2 className="mt-3.5 text-lg font-extrabold">
              {t(`landing.feature${n}.title`)}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted [word-break:keep-all]">
              {t(`landing.feature${n}.body`)}
            </p>
          </div>
        ))}
      </section>

      {/* 6. 크루 */}
      {crews.length > 0 && (
        <section
          id="crew"
          className="scroll-mt-[72px] border-y border-line-soft bg-inset"
        >
          <div className="mx-auto grid w-full max-w-[1120px] items-center gap-12 px-6 py-[72px] max-md:gap-8 max-md:px-4 max-md:py-12 md:grid-cols-2">
            <div>
              <p className="text-xs font-extrabold tracking-[0.1em] text-accent">
                CREW
              </p>
              <h2 className="mt-2 text-4xl font-extrabold tracking-tight [word-break:keep-all] max-md:text-[26px]">
                {t("landing.crewsTitle")}
              </h2>
              <p className="mt-2 text-base text-muted [word-break:keep-all]">
                {t("landing.crewsSub")}
              </p>
              <ul className="mt-6 flex flex-col gap-3.5">
                {[1, 2, 3].map((n) => (
                  <li key={n} className="flex gap-3">
                    <span
                      aria-hidden
                      className="mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-success-bg text-[11px] text-success"
                    >
                      ✓
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[15px] font-bold">
                        {t(`landing.crewPt${n}.title` as DictKey)}
                      </span>
                      <span className="mt-0.5 block text-[13px] text-muted [word-break:keep-all]">
                        {t(`landing.crewPt${n}.body` as DictKey)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <Link
                href="/crews"
                className="mt-6 flex h-11 w-fit items-center rounded-[10px] border border-line-strong px-5 text-sm font-semibold transition-colors hover:border-[#555]"
              >
                {t("landing.crewsAll")}
              </Link>
            </div>

            <div className="flex flex-col gap-3">
              {/* 대표 크루 */}
              <Link
                href={`/crews/${lead.slug}`}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 rounded-2xl border border-line-accent bg-highlight px-5 py-4 shadow-[0_20px_50px_rgba(0,0,0,.5)] transition-colors hover:border-[#8a7a2a] max-sm:grid-cols-[auto_minmax(0,1fr)]"
              >
                {lead.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={lead.logo_url}
                    alt=""
                    className="h-[52px] w-[52px] shrink-0 rounded-full border-2 border-line-strong object-cover"
                  />
                ) : (
                  <Avatar name={lead.name} size={52} />
                )}
                <div className="min-w-0">
                  <p className="truncate text-lg font-extrabold">{lead.name}</p>
                  <p className="mt-0.5 truncate text-[13px] text-muted">
                    {lead.location ? `${lead.location} · ` : ""}
                    {lead.member_count} {t("crew.members")} · {lead.post_count}{" "}
                    {t("crew.posts")}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5 max-sm:hidden">
                  <AvatarStack names={lead.member_names} max={4} />
                  <span className="text-[13px] font-bold text-accent">
                    {t("crew.goCrewPage")} →
                  </span>
                </div>
              </Link>

              {/* 다른 크루 둘 */}
              {rest.length > 0 && (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {rest.slice(0, 2).map((c) => (
                    <li key={c.slug}>
                      <Link
                        href={`/crews/${c.slug}`}
                        className="flex items-center gap-3 rounded-xl border border-line bg-card px-4 py-3.5 transition-colors hover:border-line-strong hover:bg-card-hover"
                      >
                        {c.logo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={c.logo_url}
                            alt=""
                            className="h-8 w-8 shrink-0 rounded-full object-cover"
                          />
                        ) : (
                          <Avatar name={c.name} size={32} />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold">{c.name}</p>
                          <p className="mt-0.5 truncate text-[11px] text-muted">
                            {c.location ? `${c.location} · ` : ""}
                            {c.member_count} {t("crew.members")}
                          </p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}

      {/* 7. 최종 CTA */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 h-[500px] w-[800px] max-w-none -translate-x-1/2 -translate-y-1/2"
          style={{
            background:
              "radial-gradient(ellipse, rgba(255,214,10,.08) 0%, transparent 60%)",
          }}
        />
        <div className="relative mx-auto flex w-full max-w-[1120px] flex-col items-center gap-5 px-6 py-[88px] text-center max-md:px-5 max-md:py-14">
          <Image src="/roxlogy-mark.svg" alt="" width={64} height={64} />
          <h2 className="text-[40px] font-black leading-tight tracking-tight [text-wrap:balance] [word-break:keep-all] max-md:text-[30px]">
            {t("landing.ctaTitle")}
          </h2>
          <p className="text-base text-muted [word-break:keep-all]">
            {t("landing.ctaSub")}
          </p>
          <div className="flex flex-wrap justify-center gap-3 max-md:w-full max-md:flex-col">
            <Link href="/signup" className={`${ctaPrimary} max-md:w-full`}>
              {t("landing.startFree")}
            </Link>
            <Link href="/crews" className={`${ctaGhost} max-md:w-full`}>
              {t("landing.crewsLink")}
            </Link>
          </div>
        </div>
      </section>

      {/* 8. 푸터 */}
      <footer className="border-t border-line-soft">
        <div className="mx-auto flex w-full max-w-[1120px] flex-wrap items-center gap-x-6 gap-y-3 px-6 py-6 text-[13px] text-muted max-md:flex-col max-md:items-start max-md:px-4">
          <span className="flex items-center gap-2">
            <Image src="/roxlogy-mark.svg" alt="" width={20} height={20} />
            <span className="font-extrabold tracking-[0.08em] text-foreground/80">
              ROXLOGY
            </span>
            <span className="max-sm:hidden">· {t("landing.tagline")}</span>
          </span>
          <span className="flex flex-wrap gap-x-5 gap-y-2 md:ml-auto">
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
