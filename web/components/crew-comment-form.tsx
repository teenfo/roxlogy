"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** 게시글 댓글 입력 — 시안 crew.tsx CrewBoard 의 댓글 줄(.rx-actions Input + Button) 그대로 */
export function CrewCommentForm({ postId }: { postId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      return setErr(t("common.needLogin"));
    }
    const { error } = await supabase
      .from("crew_post_comments")
      .insert({ post_id: postId, author_id: user.id, body: text });
    setBusy(false);
    if (error) return setErr(error.message);
    setBody("");
    router.refresh();
  }

  return (
    <form onSubmit={submit}>
      <div className="rx-actions">
        <Input
          aria-label={t("crew.commentPlaceholder")}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("crew.commentPlaceholder")}
          maxLength={500}
        />
        <Button type="submit" disabled={busy || !body.trim()}>
          {t("crew.commentSubmit")}
        </Button>
      </div>
      {err && (
        <p role="alert" className="rx-error">
          {err}
        </p>
      )}
    </form>
  );
}
