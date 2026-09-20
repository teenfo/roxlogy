import Link from "next/link";
import { getT } from "@/lib/i18n";

/**
 * PFT 레이스 참가 전 필수값 안내.
 *
 * 배지 컷오프는 나이(45세 기준)로 갈리고 리더보드는 성별로 나뉜다. 둘이 비어 있으면
 * 참가는 되지만 배지가 잘못 붙고 순위에서 빠진다 — 그래서 참가 앞에서 막는다.
 */
export async function ProfileRequired({ missing }: { missing: ("birth_year" | "gender")[] }) {
  const { t } = await getT();
  if (missing.length === 0) return null;
  const labels = missing
    .map((m) => t(m === "birth_year" ? "profile.birthYear" : "profile.gender"))
    .join(" · ");
  return (
    <div
      role="alert"
      className="rx-access flex flex-col gap-3 rounded-2xl border border-line-accent bg-highlight px-4 py-4"
    >
      <p className="text-sm font-extrabold text-accent-ink">{t("pft.race.needProfile")}</p>
      <p className="text-[13px] text-foreground/85 [word-break:keep-all]">
        {t("pft.race.needProfileDesc", { fields: labels })}
      </p>
      <Link
        href="/settings/profile"
        className="flex h-11 w-fit items-center rounded-lg bg-accent px-5 text-sm font-extrabold text-on-accent hover:brightness-110"
      >
        {t("pft.race.goProfile")} →
      </Link>
    </div>
  );
}

/** 프로필에서 빠진 필수값 — 서버에서 한 번 계산해 화면들이 같이 쓴다. */
export function missingForRace(p: { birth_year: number | null; gender: string | null } | null) {
  const missing: ("birth_year" | "gender")[] = [];
  if (p?.birth_year == null) missing.push("birth_year");
  if (!p?.gender) missing.push("gender");
  return missing;
}
