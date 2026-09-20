"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { POST_CATEGORIES, type PostCategory } from "@/lib/crew-types";
import type { DictKey } from "@/lib/i18n/dictionaries/en";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Choice, Field, Hint, Panel } from "@/components/rox/ui";

export type EditablePost = {
  id: string;
  category: PostCategory;
  title: string;
  body: string | null;
  members_only: boolean;
};

/**
 * 새 글 작성 / 기존 글 수정 — 시안 crew.tsx CrewBoard(new/edit) 그대로 (PORT_PLAN §3-e):
 * form > Panel[ Field 말머리 Choice · Field 제목 · Field 내용 Textarea · .rx-check 정회원 · 버튼 ].
 * 공지는 운영자·코치만 노출. edit 가 주어지면 수정 모드(작성자·운영진만, RLS 로도 보호).
 */
export function CrewPostForm({
  slug,
  crewId,
  isStaff,
  edit,
}: {
  slug: string;
  crewId: string;
  isStaff: boolean;
  edit?: EditablePost;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [category, setCategory] = useState<PostCategory>(edit?.category ?? "free");
  const [title, setTitle] = useState(edit?.title ?? "");
  const [body, setBody] = useState(edit?.body ?? "");
  const [membersOnly, setMembersOnly] = useState(edit?.members_only ?? false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const categories = POST_CATEGORIES.filter((c) => c !== "notice" || isStaff);

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
    const fields = {
      category,
      title: title.trim(),
      body: body.trim() || null,
      members_only: membersOnly,
    };
    const { data, error } = edit
      ? await supabase.from("crew_posts").update(fields).eq("id", edit.id).select("id").single()
      : await supabase
          .from("crew_posts")
          .insert({ crew_id: crewId, author_id: user.id, ...fields })
          .select("id")
          .single();
    setBusy(false);
    if (error || !data) {
      setErr(error?.message ?? t("crew.postErr"));
      return;
    }
    router.push(`/crews/${slug}/board/${data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit}>
      <Panel>
        <Field label={t("crew.postCategory")}>
          <Choice
            label={t("crew.postCategory")}
            value={category}
            onChange={(v) => setCategory(v as PostCategory)}
            options={categories.map((c) => [c, t(`crew.cat.${c}` as DictKey)] as [string, string])}
          />
        </Field>
        <Field label={`${t("crew.postTitle")} *`}>
          <Input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder={t("crew.postTitle")}
          />
        </Field>
        <Field label={`${t("crew.postBody")} *`}>
          <Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <label className="rx-check">
          <Checkbox checked={membersOnly} onCheckedChange={(v) => setMembersOnly(v === true)} />
          {t("crew.fullOnly")}
        </label>
        <Hint>{t("crew.fullOnlyPostHint")}</Hint>
        {err && (
          <p role="alert" className="rx-error">
            {err}
          </p>
        )}
        <Button className="rx-primary" type="submit" disabled={busy || !title.trim()}>
          {busy ? t("crew.publishing") : edit ? t("common.save") : t("crew.publish")}
        </Button>
      </Panel>
    </form>
  );
}
