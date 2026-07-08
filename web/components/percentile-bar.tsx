import Link from "next/link";
import { getT } from "@/lib/i18n";

/**
 * 필드 대비 백분위 표시. pct = "상위 몇 %"(작을수록 빠름).
 * 공개 집계 분포(race_benchmarks) 기준 — 절대 순위 아님.
 * heading/link로 헤더를 바꿔 대시보드 카드로도 재사용.
 */
export async function PercentileBar({
  pct,
  division,
  gender,
  heading,
  link,
}: {
  pct: number;
  division: string;
  gender: string | null;
  heading?: string;
  link?: { href: string; label: string };
}) {
  const { t } = await getT();
  const top = Math.max(1, Math.round(pct));
  const beat = Math.min(99, Math.max(1, 100 - top));
  // 바 위치: 왼쪽=빠름(상위). top%가 작을수록 왼쪽.
  const pos = Math.min(97, Math.max(3, top));

  return (
    <section className="mt-6 rounded-md bg-surface px-4 py-4">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <h2 className="text-sm font-semibold text-muted">
            {heading ?? t("percentile.title")}
          </h2>
          {link && (
            <Link
              href={link.href}
              className="truncate text-sm font-semibold text-accent hover:underline"
            >
              {link.label}
            </Link>
          )}
        </div>
        <span className="shrink-0 font-mono text-xl font-bold text-accent">
          {t("percentile.top", { pct: String(top) })}
        </span>
      </div>
      <div className="relative mt-3 h-2 rounded-full bg-gradient-to-r from-track via-accent to-red-500/70">
        <span
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow"
          style={{ left: `${pos}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-muted">
        <span>{t("percentile.faster")}</span>
        <span>{t("percentile.slower")}</span>
      </div>
      <p className="mt-2.5 text-xs text-muted">
        {t("percentile.beat", { pct: String(beat) })}{" "}
        <span className="text-muted/70">
          {t("percentile.basis", {
            division: t(`division.${division}` as Parameters<typeof t>[0]),
            gender: gender
              ? t(`profile.gender.${gender}` as Parameters<typeof t>[0])
              : t("percentile.allGenders"),
          })}
        </span>
      </p>
    </section>
  );
}
