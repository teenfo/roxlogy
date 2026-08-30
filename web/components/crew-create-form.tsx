"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

/** 새 크루 생성 — pending 으로 생성되고 관리자 승인 후 공개된다. */
export function CrewCreateForm() {
  const { t } = useI18n();
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [joinPolicy, setJoinPolicy] = useState<"open" | "approval" | "invite">("open");
  const [isPublic, setIsPublic] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const slugOk = SLUG_RE.test(slug);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !slugOk) return;
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
    const { data: crew, error } = await supabase
      .from("crews")
      .insert({
        name: name.trim(),
        slug,
        tagline: tagline.trim() || null,
        description: description.trim() || null,
        location: location.trim() || null,
        join_policy: joinPolicy,
        is_public: isPublic,
        status: "pending",
        created_by: user.id,
      })
      .select("id, slug")
      .single();
    if (error || !crew) {
      setErr(
        error?.code === "23505" ? t("crew.slugTaken") : (error?.message ?? "error"),
      );
      setBusy(false);
      return;
    }
    // 생성자를 owner 멤버로 등록 (실패해도 크루 자체는 생성됨)
    await supabase.from("crew_members").insert({
      crew_id: crew.id,
      user_id: user.id,
      role: "owner",
      status: "active",
    });
    router.push(`/crews/${crew.slug}`);
    router.refresh();
  }

  const input =
    "w-full rounded-md border border-muted/30 bg-background px-3 py-2 text-sm outline-none focus:border-accent";
  const label = "mt-4 block text-xs text-muted";

  return (
    <form onSubmit={submit} className="mt-6">
      <label className={label}>{t("crew.fName")}</label>
      <input
        className={input}
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={40}
        required
      />

      <label className={label}>{t("crew.fSlug")}</label>
      <input
        className={input}
        value={slug}
        onChange={(e) => setSlug(e.target.value.toLowerCase().trim())}
        placeholder="my-crew"
        maxLength={30}
        required
      />
      {slug && !slugOk && (
        <p className="mt-1 text-xs text-red-400">a-z, 0-9, - (3~30자)</p>
      )}

      <label className={label}>{t("crew.fTagline")}</label>
      <input
        className={input}
        value={tagline}
        onChange={(e) => setTagline(e.target.value)}
        maxLength={60}
      />

      <label className={label}>{t("crew.fDesc")}</label>
      <textarea
        className={`${input} min-h-24`}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={2000}
      />

      <label className={label}>{t("crew.fLocation")}</label>
      <input
        className={input}
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        maxLength={60}
      />

      <label className={label}>{t("crew.fPolicy")}</label>
      <div className="mt-1 flex gap-2">
        {(
          [
            ["open", t("crew.policyOpen")],
            ["approval", t("crew.policyApproval")],
            ["invite", t("crew.policyInvite")],
          ] as const
        ).map(([v, lbl]) => (
          <button
            key={v}
            type="button"
            onClick={() => setJoinPolicy(v)}
            className={`rounded-full px-3 py-1.5 text-xs ${
              joinPolicy === v
                ? "bg-accent font-bold text-background"
                : "bg-surface text-muted hover:text-foreground"
            }`}
          >
            {lbl}
          </button>
        ))}
      </div>

      <label className="mt-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isPublic}
          onChange={(e) => setIsPublic(e.target.checked)}
        />
        {t("crew.fPublic")}
      </label>

      {err && <p className="mt-3 text-sm text-red-400">{err}</p>}

      <button
        type="submit"
        disabled={busy || !name.trim() || !slugOk}
        className="mt-6 w-full rounded-md bg-accent px-5 py-2.5 text-sm font-bold text-background hover:brightness-110 disabled:opacity-40"
      >
        {t("crew.submitCreate")}
      </button>
      <p className="mt-2 text-center text-xs text-muted">{t("crew.createDesc")}</p>
    </form>
  );
}
