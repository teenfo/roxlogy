"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

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
    <>
    <form onSubmit={submit} className="mt-4 flex gap-2">
      <input
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t("crew.commentPlaceholder")}
        maxLength={500}
        className="flex-1 rounded-md border border-muted/30 bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <button
        type="submit"
        disabled={busy || !body.trim()}
        className="shrink-0 rounded-md border border-accent px-4 text-sm font-semibold text-accent hover:bg-accent/10 disabled:opacity-50"
      >
        {t("crew.commentSubmit")}
      </button>
    </form>
    {err && <p className="mt-1 text-xs text-red-400">{err}</p>}
    </>
  );
}
