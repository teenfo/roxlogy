"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Choice, Field, Hint, Panel } from "@/components/rox/ui";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

/**
 * 새 크루 생성 — 시안 crew.tsx Crews(create) 그대로 (PORT_PLAN §3-e):
 * form > Panel "크루 기본 정보"[ .rx-form-grid(이름·주소·활동 지역·가입 방식) · 소개 Textarea · 버튼 ].
 * pending 으로 생성되고 관리자 승인 후 공개된다.
 */
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
      setErr(error?.code === "23505" ? t("crew.slugTaken") : (error?.message ?? "error"));
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

  return (
    <form onSubmit={submit}>
      <Panel title={t("crew.basicInfo")}>
        <div className="rx-form-grid">
          <Field label={`${t("crew.fName")} *`}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
          </Field>
          <Field label={`${t("crew.fSlug")} *`}>
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().trim())}
              placeholder="my-crew"
              maxLength={30}
              required
            />
          </Field>
          <Field label={t("crew.fLocation")}>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={60} />
          </Field>
          <Field label={t("crew.fPolicy")}>
            <Choice
              label={t("crew.fPolicy")}
              value={joinPolicy}
              onChange={(v) => setJoinPolicy(v as typeof joinPolicy)}
              options={[
                ["approval", t("crew.policyApproval")],
                ["open", t("crew.policyOpen")],
                ["invite", t("crew.policyInvite")],
              ]}
            />
          </Field>
        </div>
        {slug && !slugOk && <p className="rx-error">{t("crew.slugHint")}</p>}
        <Field label={t("crew.fTagline")}>
          <Input value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={60} />
        </Field>
        <Field label={t("crew.fDesc")}>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
          />
        </Field>
        <label className="rx-check">
          <Checkbox checked={isPublic} onCheckedChange={(v) => setIsPublic(v === true)} />
          {t("crew.fPublic")}
        </label>
        {err && (
          <p role="alert" className="rx-error">
            {err}
          </p>
        )}
        <Button className="rx-primary" type="submit" disabled={busy || !name.trim() || !slugOk}>
          {busy ? t("common.saving") : t("crew.submitCreate")}
        </Button>
        <Hint>{t("crew.createDesc")}</Hint>
      </Panel>
    </form>
  );
}
