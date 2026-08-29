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
  const posts = await getCrewBoard(slug, category, 30);
  const canPost = isActiveMember(crew);

  const chip = (active: boolean) =>
    `shrink-0 rounded-full border px-3 py-1 text-xs ${
      active
        ? "border-accent text-accent"
        : "border-muted/40 text-muted hover:border-foreground"
    }`;

  return (
    <main>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Link href={`/crews/${slug}/board`} className={chip(!category)}>
            {t("crew.all")}
          </Link>
          {POST_CATEGORIES.map((c) => (
            <Link
              key={c}
              href={`/crews/${slug}/board?cat=${c}`}
              className={chip(category === c)}
            >
              {t(`crew.cat.${c}` as DictKey)}
            </Link>
          ))}
        </div>
        {canPost && (
          <Link
            href={`/crews/${slug}/board/new`}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-bold text-background hover:brightness-110"
          >
            {t("crew.newPost")}
          </Link>
        )}
      </div>

      {!posts.length ? (
        <p className="mt-6 rounded-md bg-surface px-4 py-12 text-center text-sm text-muted">
          {t("crew.emptyBoard")}
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {posts.map((p) => (
            <li
              key={p.id}
              className={`rounded-md px-4 py-3.5 ${
                p.pinned ? "bg-surface ring-1 ring-accent/30" : "bg-surface"
              }`}
            >
              <Link href={`/crews/${slug}/board/${p.id}`} className="block">
                <div className="flex items-center gap-2">
                  <span className="shrink-0 rounded-full border border-muted/40 px-2 py-0.5 text-[10px] text-muted">
                    {t(`crew.cat.${p.category}` as DictKey)}
                  </span>
                  {p.pinned && (
                    <span className="shrink-0 text-[10px] font-bold text-accent">
                      PIN
                    </span>
                  )}
                  {p.members_only && (
                    <span className="shrink-0 rounded-full bg-track/15 px-2 py-0.5 text-[10px] font-bold text-track">
                      {t("crew.fullOnly")}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold hover:text-accent">
                    {p.title}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 text-xs text-muted">
                  <span>{p.author_name}</span>
                  <span>{formatDateShort(p.created_at, tag, tz)}</span>
                  {p.comment_count > 0 && <span>💬 {p.comment_count}</span>}
                  {p.like_count > 0 && <span>♥ {p.like_count}</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {!canPost && (
        <p className="mt-6 text-center text-xs text-muted">
          {t("crew.memberOnly")}
        </p>
      )}
    </main>
  );
}
