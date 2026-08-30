"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

/** 게시글 수정·삭제 — 작성자 본인 또는 운영진에게만 렌더한다
 *  (서버는 crew_posts_update_own / crew_posts_delete_own 정책으로 보호). */
export function CrewPostActions({
  slug,
  postId,
}: {
  slug: string;
  postId: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function del() {
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("crew_posts")
      .delete()
      .eq("id", postId);
    setBusy(false);
    if (error) return setErr(error.message);
    router.push(`/crews/${slug}/board`);
    router.refresh();
  }

  return (
    <span className="ml-auto flex items-center gap-3 text-xs">
      <Link
        href={`/crews/${slug}/board/${postId}/edit`}
        className="text-muted hover:text-accent"
      >
        {t("common.edit")}
      </Link>
      {confirming ? (
        <>
          <button
            type="button"
            onClick={del}
            disabled={busy}
            className="font-semibold text-red-400 disabled:opacity-50"
          >
            {busy ? t("common.deleting") : t("common.confirmDelete")}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="text-muted"
          >
            {t("common.cancel")}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-muted hover:text-red-400"
        >
          {t("common.delete")}
        </button>
      )}
      {err && <span className="text-red-400">{err}</span>}
    </span>
  );
}

/** 댓글 삭제 — 본인 댓글 또는 운영진 */
export function CrewCommentDelete({ commentId }: { commentId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function del() {
    if (!window.confirm(t("crew.commentDeleteConfirm"))) return;
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("crew_post_comments")
      .delete()
      .eq("id", commentId);
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={del}
        disabled={busy}
        aria-label={t("common.delete")}
        className="ml-auto -m-2 p-2 text-xs text-muted hover:text-red-400 disabled:opacity-50"
      >
        ✕
      </button>
      {err && <span className="text-xs text-red-400">{err}</span>}
    </>
  );
}
