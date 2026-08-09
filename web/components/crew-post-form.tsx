"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { POST_CATEGORIES, type PostCategory } from "@/lib/crew-types";
import type { DictKey } from "@/lib/i18n/dictionaries/en";

/** 새 글 작성 — 공지는 운영자·코치만 노출 */
export function CrewPostForm({
  slug,
  crewId,
  isStaff,
}: {
  slug: string;
  crewId: string;
  isStaff: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [category, setCategory] = useState<PostCategory>("free");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const categories = POST_CATEGORIES.filter(
    (c) => c !== "notice" || isStaff,
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setErr(t("common.needLogin"));
      setBusy(false);
      return;
    }
    const { data, error } = await supabase
      .from("crew_posts")
      .insert({
        crew_id: crewId,
        author_id: user.id,
        category,
        title: title.trim(),
        body: body.trim() || null,
      })
      .select("id")
      .single();
    setBusy(false);
    if (error || !data) {
      setErr(t("crew.postErr"));
      return;
    }
    router.push(`/crews/${slug}/board/${data.id}`);
    router.refresh();
  }

  const field =
    "w-full rounded-md border border-muted/30 bg-surface px-3 py-2 text-sm outline-none focus:border-accent";

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
      <div>
        <label className="mb-1.5 block text-xs text-muted">
          {t("crew.postCategory")}
        </label>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`rounded-full border px-3 py-1 text-xs ${
                category === c
                  ? "border-accent text-accent"
                  : "border-muted/40 text-muted hover:border-foreground"
              }`}
            >
              {t(`crew.cat.${c}` as DictKey)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="crew-post-title" className="mb-1.5 block text-xs text-muted">
          {t("crew.postTitle")}
        </label>
        <input
          id="crew-post-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          required
          className={field}
        />
      </div>

      <div>
        <label htmlFor="crew-post-body" className="mb-1.5 block text-xs text-muted">
          {t("crew.postBody")}
        </label>
        <textarea
          id="crew-post-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={10}
          className={`${field} resize-y`}
        />
      </div>

      {err && <p className="text-sm text-red-400">{err}</p>}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={busy || !title.trim()}
          className="rounded-md bg-accent px-5 py-2 text-sm font-bold text-background hover:brightness-110 disabled:opacity-50"
        >
          {busy ? t("crew.publishing") : t("crew.publish")}
        </button>
      </div>
    </form>
  );
}
