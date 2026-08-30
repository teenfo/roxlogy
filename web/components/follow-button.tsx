"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

/** 작성자 팔로우/언팔로우 토글 — 팔로우 상태를 로드 후 반영 */
export function FollowButton({ authorId }: { authorId: string }) {
  const { t } = useI18n();
  const [following, setFollowing] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { count } = await supabase
        .from("follows")
        .select("*", { count: "exact", head: true })
        .eq("follower_id", user.id)
        .eq("followee_id", authorId);
      if (!cancelled) setFollowing((count ?? 0) > 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [authorId]);

  async function toggle() {
    setBusy(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      return setErr(t("common.needLogin"));
    }
    // 실패했는데 상태를 뒤집으면 화면과 서버가 어긋난 채로 남는다
    const { error } = following
      ? await supabase
          .from("follows")
          .delete()
          .eq("follower_id", user.id)
          .eq("followee_id", authorId)
      : await supabase
          .from("follows")
          .insert({ follower_id: user.id, followee_id: authorId });
    setBusy(false);
    if (error) return setErr(error.message);
    setErr(null);
    setFollowing(!following);
  }

  if (following === null) return null;
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className={`rounded-md border px-3 py-1.5 text-sm font-semibold disabled:opacity-50 ${
          following
            ? "border-muted/40 text-muted hover:border-foreground"
            : "border-accent text-accent hover:brightness-110"
        }`}
      >
        {following ? t("feed.following") : t("feed.follow")}
      </button>
      {err && <span className="text-xs text-red-400">{err}</span>}
    </span>
  );
}
