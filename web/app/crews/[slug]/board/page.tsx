import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Plus } from "lucide-react";
import { getCrew, getCrewBoard, isActiveMember, POST_CATEGORIES } from "@/lib/crew";
import { getT } from "@/lib/i18n";
import { formatDateShort } from "@/lib/format";
import type { DictKey } from "@/lib/i18n/dictionaries/en";
import { QuerySegments } from "@/components/rox/query-filters";
import { Chip, Empty, Go, Hint, Panel } from "@/components/rox/ui";

/**
 * 크루 게시판 — 시안 crew.tsx CrewBoard(목록) 그대로 (PORT_PLAN §3-e):
 * .rx-subhead(제목 + Go 글쓰기) · Panel[ .rx-toolbar(Segments 말머리) · .rx-board-row 링크 · Empty ].
 * 말머리 필터는 서버 필터라 QuerySegments(주소 ?cat=)로 간다. 고정 공지는 같은 행 모양으로 위에(§4).
 */
export default async function CrewBoardPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ cat?: string }> }) {
  const { slug } = await params;
  const { cat } = await searchParams;
  const category = POST_CATEGORIES.includes(cat as never) ? cat! : null;

  const [crew, { t, tag, tz }] = await Promise.all([getCrew(slug), getT()]);
  if (!crew) notFound();
  const [posts, notices] = await Promise.all([
    getCrewBoard(slug, category, 30),
    // 상단 고정 공지 영역 — 최신 공지 5건 (공지 필터 화면에서는 목록과 중복이라 생략)
    category === "notice" ? Promise.resolve([]) : getCrewBoard(slug, "notice", 5),
  ]);
  const canPost = isActiveMember(crew);
  const base = `/crews/${slug}/board`;
  const noticeIds = new Set(notices.map((n) => n.id));
  const rows = posts.filter((p) => !noticeIds.has(p.id));

  const row = (p: (typeof posts)[number], pinned = false) => (
    <Link className="rx-board-row" key={p.id} href={`${base}/${p.id}`}>
      <Chip tone={p.category === "notice" ? "yellow" : "neutral"}>{t(`crew.cat.${p.category}` as DictKey)}</Chip>
      <div>
        <h3>
          {p.title}
          {pinned && p.pinned ? " 📌" : ""}
          {p.members_only ? ` · ${t("crew.fullOnly")}` : ""}
        </h3>
        <p>
          {t("crew.postAuthorLine", { name: p.author_name, date: formatDateShort(p.created_at, tag, tz) })}
          {p.comment_count > 0 ? ` · 💬 ${p.comment_count}` : ""}
          {p.like_count > 0 ? ` · ♥ ${p.like_count}` : ""}
        </p>
      </div>
      <ArrowRight size={18} />
    </Link>
  );

  return (
    <>
      <div className="rx-subhead">
        <h2>{t("crew.boardTitle")}</h2>
        {canPost && (
          <Go href={`${base}/new`} primary>
            <Plus size={16} />
            {t("crew.newPost")}
          </Go>
        )}
      </div>
      <Panel>
        <div className="rx-toolbar">
          <QuerySegments
            label={t("crew.board")}
            param="cat"
            value={category ?? "all"}
            options={[["all", t("crew.all")], ...POST_CATEGORIES.map((c) => [c, t(`crew.cat.${c}` as DictKey)] as [string, string])]}
          />
        </div>
        {notices.map((n) => row(n, true))}
        {rows.map((p) => row(p))}
        {!posts.length && <Empty title={t("crew.emptyBoard")} description={t("crew.writePostDesc")} />}
        {!canPost && <Hint>{t("crew.memberOnly")}</Hint>}
      </Panel>
    </>
  );
}
