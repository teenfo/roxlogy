"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";

/** 게시글 좋아요 토글 — 시안 CrewBoard 의 outline 버튼(aria-pressed) 그대로.
 *  카운트는 DB 트리거가 유지하므로 낙관적 갱신만 한다 */
export function CrewLikeButton({
  postId,
  initialLiked,
  initialCount,
  canLike,
}: {
  postId: string;
  initialLiked: boolean;
  initialCount: number;
  canLike: boolean;
}) {
  const { t } = useI18n();
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (!canLike || busy) return;
    setBusy(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      return;
    }
    if (liked) {
      await supabase.from("crew_post_likes").delete().eq("post_id", postId).eq("user_id", user.id);
      setLiked(false);
      setCount((c) => Math.max(c - 1, 0));
    } else {
      await supabase.from("crew_post_likes").insert({ post_id: postId, user_id: user.id });
      setLiked(true);
      setCount((c) => c + 1);
    }
    setBusy(false);
  }

  return (
    <Button
      variant="outline"
      type="button"
      onClick={toggle}
      disabled={!canLike || busy}
      aria-pressed={liked}
      className={liked ? "selected" : ""}
    >
      {liked ? "♥" : "♡"} {t("crew.likeN", { n: count })}
    </Button>
  );
}
