import Link from "next/link";
import { getCrewDirectory, getMyCrews } from "@/lib/crew";
import { getCachedUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n";
import { CrewHeader } from "@/components/crew-header";
import { CrewFinder } from "@/components/crew-finder";
import { Avatar, AvatarStack, Card } from "@/components/ui/crew-ui";
import { crewRoleBadgeClass, crewRoleDictKey, isStaffRole, tierBadgeClass } from "@/lib/crew-role";

export async function generateMetadata() {
  const { t } = await getT();
  return {
    title: `${t("crew.directoryTitle")} — Roxlogy`,
    description: t("crew.directorySub"),
  };
}

export default async function CrewDirectoryPage() {
  const [crews, mine, user, { t, tag, tz }] = await Promise.all([
    getCrewDirectory(),
    getMyCrews(),
    getCachedUser(),
    getT(),
  ]);

  const whenLabel = (iso: string) =>
    new Date(iso).toLocaleString(tag, {
      month: "short",
      day: "numeric",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: tz,
    });

  return (
    <>
      <CrewHeader loginNext="/crews" />

      <main className="mx-auto w-full max-w-[960px] flex-1 px-6 pb-20 pt-8 max-md:px-4 max-md:pb-28">
        {/* 헤더 */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">
              {t("crew.directoryTitle")}
            </h1>
            <p className="mt-1 text-[15px] text-muted">
              {t("crew.directorySub")}
            </p>
          </div>
          <Link
            href={user ? "/crews/new" : "/login?next=%2Fcrews%2Fnew"}
            className="shrink-0 rounded-full bg-accent px-5 py-2.5 text-sm font-extrabold text-background hover:brightness-110"
          >
            + {t("crew.createCta")}
          </Link>
        </div>

        {/* 비로그인 안내 — 목록·소개는 그냥 보이고, 가입·일정만 로그인이 필요하다 */}
        {!user && (
          <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-card px-4 py-3">
            <span className="text-sm text-muted">{t("crew.guestNote")}</span>
            <Link
              href="/login?next=%2Fcrews"
              className="text-sm font-bold text-accent hover:underline"
            >
              {t("common.login")} →
            </Link>
          </div>
        )}

        {/* 내 크루 */}
        {mine.length > 0 && (
          <section className="mt-8">
            <p className="mb-2 text-xs font-bold tracking-[0.06em] text-accent">
              {t("crew.myCrews")}
            </p>
            <ul className="flex flex-col gap-3">
              {mine.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={`/crews/${c.slug}`}
                    className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-5 rounded-2xl border border-line-accent bg-highlight px-6 py-5 transition-colors hover:border-[#8a7a2a] max-sm:grid-cols-[auto_minmax(0,1fr)]"
                  >
                    {c.logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.logo_url}
                        alt=""
                        className="h-16 w-16 shrink-0 rounded-full border-2 border-line-strong object-cover"
                      />
                    ) : (
                      <Avatar name={c.name} size={64} />
                    )}

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[22px] font-extrabold">
                          {c.name}
                        </span>
                        {isStaffRole(c.role) ? (
                          <span
                            className={`rounded-md px-2 py-0.5 text-xs font-extrabold ${crewRoleBadgeClass(c.role)}`}
                          >
                            {t(crewRoleDictKey(c.role))}
                          </span>
                        ) : (
                          c.tier && (
                            <span
                              className={`rounded-md px-2 py-0.5 text-xs font-extrabold ${tierBadgeClass(c.tier_color)}`}
                            >
                              {c.tier}
                            </span>
                          )
                        )}
                      </div>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-foreground/75">
                        {c.location && (
                          <>
                            <span>{c.location}</span>
                            <span className="text-muted/60">|</span>
                          </>
                        )}
                        <span>
                          {c.member_count} {t("crew.members")} ·{" "}
                          {c.post_count} {t("crew.posts")}
                        </span>
                      </p>
                      {/* 다음 모임 — 없으면 행 자체를 감춘다 */}
                      {c.next_event && (
                        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-[13px]">
                          <span
                            aria-hidden
                            className="inline-block h-1.5 w-1.5 rounded-full bg-accent"
                          />
                          <span className="font-bold text-accent">
                            {t("crew.nextMeetup")}
                          </span>
                          <span className="text-foreground/85">
                            {whenLabel(c.next_event.starts_at)} ·{" "}
                            {c.next_event.title}
                          </span>
                          {c.next_event.going > 0 && (
                            <span className="text-muted">
                              · {t("crew.goingN", { n: c.next_event.going })}
                            </span>
                          )}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-2 max-sm:hidden">
                      <AvatarStack names={c.member_names} max={4} />
                      <span className="text-[13px] font-bold text-accent">
                        {t("crew.goCrewPage")} →
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 크루 찾기 — 지역 칩 + 검색은 클라이언트에서 즉시 반영 */}
        <section className="mt-8">
          {!crews.length ? (
            <Card className="px-4 py-10 text-center">
              <p className="text-sm text-muted">{t("crew.directoryEmpty")}</p>
            </Card>
          ) : (
            <CrewFinder crews={crews} />
          )}
        </section>
      </main>
    </>
  );
}
