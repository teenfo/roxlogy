import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getCrew,
  getCrewBoard,
  isActiveMember,
  POST_CATEGORIES,
} from "@/lib/crew";
import { getT } from "@/lib/i18n";
import { formatDateShort } from "@/lib/format";
import type { DictKey } from "@/lib/i18n/dictionaries/en";
import { Badge, Card, Chip } from "@/components/ui/crew-ui";

export default async function CrewBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ cat?: string }>;
}) {
  const { slug } = await params;
  const { cat } = await searchParams;
  const category = POST_CATEGORIES.includes(cat as never) ? cat! : null;

  const [crew, { t, tag, tz }] = await Promise.all([getCrew(slug), getT()]);
  if (!crew) notFound();
  const [posts, notices] = await Promise.all([
    getCrewBoard(slug, category, 30),
    // 상단 고정 공지 영역 — 최신 공지 5건 (공지 필터 화면에서는 목록과 중복이라 생략)
    category === "notice"
      ? Promise.resolve([])
      : getCrewBoard(slug, "notice", 5),
  ]);
  const canPost = isActiveMember(crew);

  // 칩에 글 수를 붙인다 — 어느 분류에 글이 있는지 눌러 보기 전에 알 수 있게
  const countByCat = new Map<string, number>();
  for (const p of posts) {
    countByCat.set(p.category, (countByCat.get(p.category) ?? 0) + 1);
  }

  return (
    <main>
      {/* 필터 칩 + 글쓰기 */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip href={`/crews/${slug}/board`} active={!category}>
          {t("crew.all")}
        </Chip>
        {POST_CATEGORIES.map((c) => (
          <Chip
            key={c}
            href={`/crews/${slug}/board?cat=${c}`}
            active={category === c}
            count={category == null ? countByCat.get(c) : undefined}
          >
            {t(`crew.cat.${c}` as DictKey)}
          </Chip>
        ))}
        {canPost && (
          <Link
            href={`/crews/${slug}/board/new`}
            className="ml-auto shrink-0 rounded-lg bg-accent px-4 py-2 text-[13px] font-bold text-background hover:brightness-110"
          >
            + {t("crew.newPost")}
          </Link>
        )}
      </div>

      {/* 고정 공지 */}
      {notices.length > 0 && (
        <section className="mt-6">
          <p className="mb-2 text-xs font-bold text-accent">
            {t("crew.pinnedNotices")}
          </p>
          <Card highlight className="divide-y divide-line-accent/40 overflow-hidden">
            {notices.map((n) => (
              <Link
                key={n.id}
                href={`/crews/${slug}/board/${n.id}`}
                className="flex items-center gap-2.5 px-5 py-3 transition-colors hover:bg-accent/5"
              >
                <span className="shrink-0 rounded-md bg-accent px-2 py-0.5 text-xs font-extrabold text-background">
                  {t("crew.cat.notice")}
                </span>
                <span className="min-w-0 flex-1 truncate text-[15px] font-bold">
                  {n.title}
                </span>
                {n.members_only && (
                  <Badge tone="label">{t("crew.fullOnly")}</Badge>
                )}
                <span className="shrink-0 text-[13px] text-muted">
                  {n.author_name} · {formatDateShort(n.created_at, tag, tz)}
                </span>
              </Link>
            ))}
          </Card>
        </section>
      )}

      {/* 전체 글 */}
      <section className="mt-6">
        <p className="mb-2 text-xs font-bold text-muted">
          {t("crew.allPosts")}
        </p>
        {!posts.length ? (
          <Card className="px-4 py-10 text-center">
            <p className="text-[13px] text-muted">{t("crew.emptyBoard")}</p>
          </Card>
        ) : (
          <Card className="divide-y divide-line overflow-hidden">
            {posts.map((p) => (
              <Link
                key={p.id}
                href={`/crews/${slug}/board/${p.id}`}
                className="block px-5 py-3.5 transition-colors hover:bg-card-hover"
              >
                <div className="flex items-center gap-2.5">
                  <Badge tone={p.category === "notice" ? "accent" : "neutral"}>
                    {t(`crew.cat.${p.category}` as DictKey)}
                  </Badge>
                  {p.pinned && <Badge outline>PIN</Badge>}
                  {p.members_only && (
                    <Badge tone="label">{t("crew.fullOnly")}</Badge>
                  )}
                  <span className="min-w-0 flex-1 truncate text-[15px] font-bold">
                    {p.title}
                  </span>
                </div>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-3 text-[13px] text-muted">
                  <span>{p.author_name}</span>
                  <span>{formatDateShort(p.created_at, tag, tz)}</span>
                  {p.comment_count > 0 && <span>💬 {p.comment_count}</span>}
                  {p.like_count > 0 && <span>♥ {p.like_count}</span>}
                </p>
              </Link>
            ))}
          </Card>
        )}
      </section>

      {!canPost && (
        <p className="mt-6 text-center text-xs text-muted">
          {t("crew.memberOnly")}
        </p>
      )}
    </main>
  );
}
