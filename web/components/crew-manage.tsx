"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { crewRoleBadgeClass, isStaffRole, tierTextClass } from "@/lib/crew-role";
import { Avatar } from "@/components/ui/crew-ui";
import { Dialog } from "@/components/ui/dialog";
import type { CrewTier } from "@/components/crew-tier-manage";
import { duesErrText } from "@/lib/dues-error";

/** 입력 한 칸 */
const input =
  "h-10 w-full min-w-0 rounded-lg border border-line-strong bg-page px-3 text-sm outline-none focus:border-accent-line";
const area =
  "w-full min-w-0 rounded-lg border border-line-strong bg-page px-3 py-2.5 text-sm leading-relaxed outline-none focus:border-accent-line";
const fieldLabel = "mb-1.5 block text-xs text-muted";
const CARD = "rounded-[14px] border border-line bg-card";
const CARD_HEAD = "border-b border-line px-[18px] py-3.5 text-[15px] font-extrabold";

/** 라벨 + 입력 한 묶음 */
function Field({
  label,
  hint,
  right,
  children,
}: {
  label: string;
  hint?: string;
  /** 글자 수 같은 우측 보조 표시 */
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className={`${fieldLabel} flex items-center justify-between gap-2`}>
        <span className="min-w-0 truncate">{label}</span>
        {right && <span className="shrink-0 text-muted-3">{right}</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted-3">{hint}</span>}
    </label>
  );
}

/**
 * 크루 정보 수정 — 크루명·주소는 변경 불가(표시만). 스태프 전용.
 * 소개 화면에 노출되는 항목(운영시간·문의·공식 링크 = links JSONB)까지 전부 여기서 고친다.
 *
 * 디자인 시안(2026-09): 14개 필드가 한 줄로 이어지던 폼을 다섯 장의 카드(브랜딩·기본
 * 정보·활동 정보·크루원 전용·가입/공개)로 묶고, 우측에 **목록 카드 미리보기**를 붙여
 * 고치는 즉시 `/crews` 에서 어떻게 보일지 알 수 있게 했다. 저장 바는 변경 개수를 센다.
 * Supabase 업데이트는 그대로다 — links 는 통째로 갈아끼우지 않고 키를 보존해 덮어쓴다.
 */
export function CrewInfoForm({
  crew,
  logoUrl,
  coverUrl,
  memberCount,
  postCount,
}: {
  crew: {
    id: string;
    slug: string;
    name: string;
    tagline: string | null;
    description: string | null;
    location: string | null;
    links: Record<string, string | null> | null;
    join_policy: "open" | "approval" | "invite";
    is_public: boolean;
  };
  logoUrl: string | null;
  coverUrl: string | null;
  memberCount: number;
  postCount: number;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const links = crew.links ?? {};
  const [tagline, setTagline] = useState(crew.tagline ?? "");
  const [description, setDescription] = useState(crew.description ?? "");
  const [location, setLocation] = useState(crew.location ?? "");
  const [hoursWeekday, setHoursWeekday] = useState(links.hours_weekday ?? "");
  const [hoursWeekend, setHoursWeekend] = useState(links.hours_weekend ?? "");
  const [phone, setPhone] = useState(links.phone ?? "");
  const [official, setOfficial] = useState(links.official ?? "");
  const [photos, setPhotos] = useState(links.photos ?? "");
  const [policy, setPolicy] = useState(links.policy ?? "");
  const [bankAccount, setBankAccount] = useState(links.bank_account ?? "");
  const [joinPolicy, setJoinPolicy] = useState(crew.join_policy);
  const [isPublic, setIsPublic] = useState(crew.is_public);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // 하단 저장 바가 "변경 사항 없음"을 정확히 말하려면 원본과 비교해야 한다.
  // 값 비교라 렌더 중 계산해도 안전하다(불순 함수 호출 없음).
  const changed: boolean[] = [
    tagline !== (crew.tagline ?? ""),
    description !== (crew.description ?? ""),
    location !== (crew.location ?? ""),
    hoursWeekday !== (links.hours_weekday ?? ""),
    hoursWeekend !== (links.hours_weekend ?? ""),
    phone !== (links.phone ?? ""),
    official !== (links.official ?? ""),
    photos !== (links.photos ?? ""),
    policy !== (links.policy ?? ""),
    bankAccount !== (links.bank_account ?? ""),
    joinPolicy !== crew.join_policy,
    isPublic !== crew.is_public,
  ];
  const dirtyCount = changed.filter(Boolean).length;
  const dirty = dirtyCount > 0;

  function revert() {
    setTagline(crew.tagline ?? "");
    setDescription(crew.description ?? "");
    setLocation(crew.location ?? "");
    setHoursWeekday(links.hours_weekday ?? "");
    setHoursWeekend(links.hours_weekend ?? "");
    setPhone(links.phone ?? "");
    setOfficial(links.official ?? "");
    setPhotos(links.photos ?? "");
    setPolicy(links.policy ?? "");
    setBankAccount(links.bank_account ?? "");
    setJoinPolicy(crew.join_policy);
    setIsPublic(crew.is_public);
    setMsg(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    // links 는 통째로 교체하지 않고 기존 키를 보존한 채 편집 필드만 덮어쓴다.
    const nextLinks: Record<string, string | null> = {
      ...links,
      hours_weekday: hoursWeekday.trim() || null,
      hours_weekend: hoursWeekend.trim() || null,
      phone: phone.trim() || null,
      official: official.trim() || null,
      photos: photos.trim() || null,
      policy: policy.trim() || null,
      bank_account: bankAccount.trim() || null,
    };
    for (const k of Object.keys(nextLinks)) {
      if (nextLinks[k] == null) delete nextLinks[k];
    }
    const { error } = await supabase
      .from("crews")
      .update({
        tagline: tagline.trim() || null,
        description: description.trim() || null,
        location: location.trim() || null,
        links: nextLinks,
        join_policy: joinPolicy,
        is_public: isPublic,
      })
      .eq("id", crew.id);
    setBusy(false);
    setMsg(error ? error.message : t("crew.saved"));
    if (!error) router.refresh();
  }

  const POLICIES = [
    ["open", t("crew.policyOpen"), t("crew.policyOpenDesc")],
    ["approval", t("crew.policyApproval"), t("crew.policyApprovalDesc")],
    ["invite", t("crew.policyInvite"), t("crew.policyInviteDesc")],
  ] as const;
  const policyBadge =
    joinPolicy === "open"
      ? "bg-success-bg text-success"
      : joinPolicy === "approval"
        ? "bg-label-bg text-label"
        : "bg-line text-muted";

  return (
    <form onSubmit={save} className="grid items-start gap-4 min-[900px]:grid-cols-[minmax(0,1fr)_280px]">
      <div className="flex flex-col gap-3.5">
        {/* 1. 브랜딩 — 업로드는 저장 바와 무관하게 즉시 반영된다 */}
        <section className={CARD}>
          <h3 className={CARD_HEAD}>{t("crew.infoBranding")}</h3>
          <div className="flex flex-col gap-5 p-[18px] sm:flex-row sm:items-start">
            <CrewImageUpload crewId={crew.id} url={logoUrl} kind="logo" />
            <CrewImageUpload crewId={crew.id} url={coverUrl} kind="cover" />
          </div>
        </section>

        {/* 2. 기본 정보 */}
        <section className={CARD}>
          <h3 className={CARD_HEAD}>{t("crew.infoBasic")}</h3>
          <div className="flex flex-col gap-3.5 p-[18px]">
            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field label={t("crew.fName")} hint={t("crew.nameLocked")}>
                <input className={`${input} opacity-50`} value={crew.name} disabled />
              </Field>
              <Field label={t("crew.fSlug")}>
                {/* 접두는 줄지 않고 입력만 줄어야 한다 — 접두에 shrink-0, 입력에 w-0 */}
                <span className="flex h-10 items-center overflow-hidden rounded-lg border border-line-strong bg-page opacity-50">
                  <span className="shrink-0 whitespace-nowrap border-r border-line-strong px-2.5 text-xs text-muted-3">
                    roxlogy.com/crews/
                  </span>
                  <input
                    className="h-full w-0 min-w-0 flex-1 bg-transparent px-2.5 text-sm outline-none"
                    value={crew.slug}
                    disabled
                    aria-label={t("crew.fSlug")}
                  />
                </span>
              </Field>
            </div>
            <Field label={t("crew.fTagline")} right={`${tagline.length}/60`}>
              <input
                className={input}
                size={1}
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                maxLength={60}
              />
            </Field>
            <Field label={t("crew.fDesc")}>
              <textarea
                className={`${area} min-h-24`}
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={2000}
              />
            </Field>
          </div>
        </section>

        {/* 3. 활동 정보 */}
        <section className={CARD}>
          <h3 className={CARD_HEAD}>{t("crew.infoActivity")}</h3>
          <div className="flex flex-col gap-3.5 p-[18px]">
            <Field label={t("crew.fLocation")}>
              <input
                className={input}
                size={1}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                maxLength={60}
              />
            </Field>
            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field label={t("crew.fHoursWeekday")}>
                <input
                  className={input}
                  size={1}
                  placeholder={t("crew.hoursPh")}
                  value={hoursWeekday}
                  onChange={(e) => setHoursWeekday(e.target.value)}
                  maxLength={60}
                />
              </Field>
              <Field label={t("crew.fHoursWeekend")}>
                <input
                  className={input}
                  size={1}
                  placeholder={t("crew.hoursPh")}
                  value={hoursWeekend}
                  onChange={(e) => setHoursWeekend(e.target.value)}
                  maxLength={60}
                />
              </Field>
            </div>
            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field label={t("crew.fPhone")}>
                <input
                  className={input}
                  size={1}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  maxLength={60}
                />
              </Field>
              <Field label={t("crew.fOfficial")}>
                <input
                  className={input}
                  size={1}
                  value={official}
                  onChange={(e) => setOfficial(e.target.value)}
                  maxLength={200}
                  placeholder="https://"
                  inputMode="url"
                />
              </Field>
            </div>
          </div>
        </section>

        {/* 4. 크루원 전용 — 소개 탭에서 크루원에게만 보이는 항목 */}
        <section className={CARD}>
          <h3 className={`${CARD_HEAD} flex flex-wrap items-center gap-2`}>
            {t("crew.infoMembersOnly")}
            <span className="rounded bg-label-bg px-1.5 py-0.5 text-[10px] font-bold text-label">
              {t("crew.membersOnlyBadge")}
            </span>
          </h3>
          <div className="flex flex-col gap-3.5 p-[18px]">
            <Field label={t("crew.fPhotos")} hint={t("crew.fPhotosHint")}>
              <input
                className={input}
                size={1}
                value={photos}
                onChange={(e) => setPhotos(e.target.value)}
                maxLength={500}
                placeholder="https://photos.app.goo.gl/..."
                inputMode="url"
              />
            </Field>
            <Field label={t("crew.fBankAccount")}>
              <input
                className={input}
                size={1}
                value={bankAccount}
                onChange={(e) => setBankAccount(e.target.value)}
                maxLength={80}
                placeholder={t("crew.fBankAccountHint")}
              />
            </Field>
            <Field label={t("crew.fRules")} hint={t("crew.fRulesHint")}>
              <textarea
                className={`${area} min-h-24`}
                rows={4}
                value={policy}
                onChange={(e) => setPolicy(e.target.value)}
                maxLength={2000}
              />
            </Field>
          </div>
        </section>

        {/* 5. 가입 · 공개 */}
        <section className={CARD}>
          <h3 className={CARD_HEAD}>{t("crew.infoJoin")}</h3>
          <div className="flex flex-col gap-3.5 p-[18px]">
            <div>
              <span className={fieldLabel}>{t("crew.fPolicy")}</span>
              <div className="grid gap-2 sm:grid-cols-3">
                {POLICIES.map(([v, lbl, desc]) => {
                  const on = joinPolicy === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setJoinPolicy(v)}
                      className={`rounded-[10px] border px-3.5 py-3 text-left ${
                        on ? "border-line-accent bg-highlight" : "border-line bg-page hover:border-line-strongest"
                      }`}
                    >
                      <span className={`block text-sm font-bold ${on ? "text-gold" : ""}`}>
                        {lbl}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-3">{desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div
              className={`flex items-center gap-3 rounded-[10px] border px-3.5 py-3 ${
                isPublic ? "border-line-accent bg-highlight" : "border-line bg-page"
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold">{t("crew.fPublicShort")}</span>
                <span className="mt-0.5 block text-xs text-muted-3">{t("crew.fPublicDesc")}</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={isPublic}
                aria-label={t("crew.fPublicShort")}
                onClick={() => setIsPublic((p) => !p)}
                className={`relative h-[26px] w-11 shrink-0 rounded-full transition-colors ${
                  isPublic ? "bg-accent" : "bg-line-strong"
                }`}
              >
                <span
                  className={`absolute top-[3px] h-5 w-5 rounded-full transition-[left] ${
                    isPublic ? "left-[23px] bg-background" : "left-[3px] bg-muted"
                  }`}
                />
              </button>
            </div>
          </div>
        </section>

        {/* 하단 저장 바 — 폼이 길어 스크롤 끝까지 내려야 저장 버튼이 나왔다.
            아래 탭바(모바일)와 겹치지 않도록 띄운다. */}
        <div className="sticky bottom-0 z-30 -mx-1 flex flex-wrap items-center gap-3 border-t border-line bg-[color-mix(in_srgb,var(--page)_93%,transparent)] px-1 py-3 backdrop-blur max-md:bottom-[84px]">
          <span
            aria-hidden
            className={`h-2 w-2 shrink-0 rounded-full ${
              dirty ? "bg-accent" : msg ? "bg-success" : "bg-line-strongest"
            }`}
          />
          <p className={`text-[13px] ${dirty ? "text-gold" : "text-muted"}`}>
            {dirty ? t("crew.unsavedN", { n: dirtyCount }) : (msg ?? t("crew.noChanges"))}
          </p>
          <span className="ml-auto flex items-center gap-2">
            {dirty && (
              <button
                type="button"
                onClick={revert}
                disabled={busy}
                className="h-10 rounded-lg border border-line-strong bg-control px-4 text-sm font-semibold hover:border-line-strong"
              >
                {t("crew.revert")}
              </button>
            )}
            <button
              type="submit"
              disabled={busy || !dirty}
              className="h-10 rounded-lg bg-accent px-5 text-sm font-extrabold text-accent-foreground hover:brightness-95 disabled:bg-line-mid disabled:text-muted-3"
            >
              {busy ? t("common.saving") : t("crew.save")}
            </button>
          </span>
        </div>
      </div>

      {/* 우측 — 목록 카드 미리보기. 저장 전 값으로 그려 고치는 즉시 보이게 한다 */}
      <aside className="order-first flex flex-col gap-3 min-[900px]:order-none min-[900px]:sticky min-[900px]:top-5">
        <div className={CARD}>
          <p className="border-b border-line px-[18px] py-3 text-xs text-muted">
            {t("crew.preview")}
          </p>
          <div className="flex flex-col gap-3 p-[18px]">
            <div className="flex items-start gap-2.5">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="h-10 w-10 shrink-0 rounded-full border border-line-strongest" />
              )}
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-[15px] font-extrabold">{crew.name}</span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${policyBadge}`}>
                    {t(
                      joinPolicy === "open"
                        ? "crew.policyOpen"
                        : joinPolicy === "approval"
                          ? "crew.policyApproval"
                          : "crew.policyInvite",
                    )}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted">
                  {[location, hoursWeekend || hoursWeekday].filter(Boolean).join(" · ") || "—"}
                </span>
              </span>
            </div>
            <p className="line-clamp-2 text-[13px] leading-relaxed text-foreground-2">
              {description || tagline || t("crew.previewNoDesc")}
            </p>
            <div className="flex items-center gap-2 border-t border-line pt-2.5 text-xs text-muted">
              <span>
                <strong className="tabular text-foreground">{memberCount}</strong>{" "}
                {t("crew.memberUnit")}
              </span>
              <span>
                <strong className="tabular text-foreground">{postCount}</strong>{" "}
                {t("crew.postUnit")}
              </span>
              <span className={`ml-auto ${isPublic ? "text-success" : "text-muted-3"}`}>
                {t(isPublic ? "crew.previewPublic" : "crew.previewPrivate")}
              </span>
            </div>
          </div>
        </div>
        <Link
          href={`/crews/${crew.slug}`}
          className={`${CARD} px-[18px] py-3 text-xs text-gold hover:underline`}
        >
          {t("crew.openCrewPage")}
        </Link>
      </aside>
    </form>
  );
}

/** 큰 이미지는 반려하지 않고 캔버스로 축소한다 — 긴 변을 maxDim 이하로 맞추고
 *  WebP 로 재인코딩. 2MB(버킷 상한)를 넘으면 품질을 낮춰가며 재시도. */
async function downscaleImage(file: File, maxDim: number): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  for (const quality of [0.85, 0.7, 0.5, 0.3]) {
    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, "image/webp", quality),
    );
    if (blob && blob.size <= 2 * 1024 * 1024) return blob;
  }
  throw new Error("image too large after resize");
}

/** 크루 이미지(로고·커버) 업로드 — 스태프 전용. crew-logos/<crewId>/<kind> 에
 *  업서트하고 해당 컬럼에 캐시버스터(?v=) 붙인 공개 URL 을 저장한다. */

/**
 * 크루 이미지(로고·커버) 업로드 — 스태프 전용. crew-logos/<crewId>/<kind> 에
 * 업서트하고 해당 컬럼에 캐시버스터(?v=) 붙인 공개 URL 을 저장한다.
 *
 * 브랜딩 카드 안에 들어간다: 로고는 96px 원에 ✎ 배지, 커버는 120px 배너에 "커버 변경"
 * 버튼을 얹는다. 폼의 저장 바와 무관하게 **고르는 즉시 저장**되므로 안내를 옆에 적는다.
 */
export function CrewImageUpload({
  crewId,
  url,
  kind,
}: {
  crewId: string;
  url: string | null;
  kind: "logo" | "cover";
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const column = kind === "logo" ? "logo_url" : "cover_url";
  // 로고는 정사각 512px, 커버는 가로 1600px 이면 충분하다.
  const maxDim = kind === "logo" ? 512 : 1600;

  async function upload(file: File) {
    setBusy(true);
    setErr(null);
    try {
      const blob = await downscaleImage(file, maxDim);
      const supabase = createClient();
      const path = `${crewId}/${kind}`;
      const { error: upErr } = await supabase.storage
        .from("crew-logos")
        .upload(path, blob, { upsert: true, contentType: "image/webp" });
      if (upErr) throw new Error(upErr.message);
      const { data } = supabase.storage.from("crew-logos").getPublicUrl(path);
      const { error } = await supabase
        .from("crews")
        .update({ [column]: `${data.publicUrl}?v=${Date.now()}` })
        .eq("id", crewId);
      if (error) throw new Error(error.message);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("crew.imgFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    await supabase.storage.from("crew-logos").remove([`${crewId}/${kind}`]);
    const { error } = await supabase
      .from("crews")
      .update({ [column]: null })
      .eq("id", crewId);
    setBusy(false);
    if (error) setErr(error.message);
    else router.refresh();
  }

  const picker = (children: React.ReactNode, cls: string) => (
    <label className={cls} title={t(kind === "logo" ? "crew.logoEdit" : "crew.coverChange")}>
      {children}
      <input
        type="file"
        accept="image/*"
        className="hidden"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          e.target.value = "";
        }}
      />
    </label>
  );

  if (kind === "logo") {
    return (
      <div className="flex shrink-0 flex-col items-center gap-2">
        {picker(
          <>
            <span className="relative block h-24 w-24 cursor-pointer rounded-full border-2 border-line-strongest hover:border-accent-line">
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt="" className="h-full w-full rounded-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center rounded-full text-xs text-muted">
                  {busy ? "…" : t("crew.logoNone")}
                </span>
              )}
              <span
                aria-hidden
                className="absolute -bottom-0.5 -right-0.5 flex h-[30px] w-[30px] items-center justify-center rounded-full border-[3px] border-card bg-accent text-xs text-accent-foreground"
              >
                ✎
              </span>
            </span>
          </>,
          "block",
        )}
        <span className="text-[11px] text-muted-3">{t("crew.logoSquareHint")}</span>
        {url && (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="text-xs text-muted-3 hover:text-danger disabled:opacity-50"
          >
            {t("crew.logoRemove")}
          </button>
        )}
        {err && (
          <p role="alert" className="text-xs text-danger">
            {err}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted">{t("crew.coverTitle")}</span>
        {url && (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="text-xs text-muted-3 hover:text-danger disabled:opacity-50"
          >
            {t("crew.logoRemove")}
          </button>
        )}
      </div>
      {picker(
        <span className="relative block h-[120px] w-full cursor-pointer overflow-hidden rounded-[10px] border border-line-strong hover:border-accent-line">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center bg-page text-xs text-muted">
              {busy ? "…" : t("crew.coverNone")}
            </span>
          )}
          <span className="absolute bottom-2 right-2 flex h-[30px] items-center rounded-lg border border-line-strong bg-[color-mix(in_srgb,var(--page)_85%,transparent)] px-2.5 text-xs font-semibold">
            ◫ {t("crew.coverChange")}
          </span>
        </span>,
        "block",
      )}
      <span className="text-[11px] text-muted-3">{t("crew.coverBannerHint")}</span>
      {err && (
        <p role="alert" className="text-xs text-danger">
          {err}
        </p>
      )}
    </div>
  );
}

export type ManageMember = {
  user_id: string;
  display_name: string;
  email: string | null;
  role: "owner" | "coach" | "member" | "associate";
  status: "pending" | "active" | "blocked";
  joined_at: string;
  tier_id: string | null;
  tier_name: string | null;
  tier_color: string | null;
  /** 무료 행사 포함 전체 출석 / 유료 모임만 */
  attend_count: number;
  attend_paid_count: number;
};

/** 한 페이지에 20명. 크루가 100명을 넘어가면 한 화면에 다 깔 수 없다. */
const PAGE = 20;

/** ⋯ 행 메뉴 — 바깥을 덮는 버튼으로 바깥 클릭·ESC 를 받는다(document 리스너 없이). */
function RowMenu({
  label,
  children,
}: {
  label: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  return (
    <span className="relative shrink-0">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((p) => !p)}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-line-strong text-base leading-none text-muted hover:border-line-strong hover:text-foreground"
      >
        ⋯
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <span className="absolute right-0 top-9 z-20 flex w-[180px] flex-col rounded-[10px] border border-line-strong bg-card-hover p-1.5 shadow-[var(--shadow-pop)]">
            {children(() => setOpen(false))}
          </span>
        </>
      )}
    </span>
  );
}

/** 색은 항목마다 붙인다 — 여기에 text-foreground 를 넣으면 "제외"의 text-danger 와
 *  같은 자리를 다퉈 어느 쪽이 이길지가 CSS 순서에 달린다. */
const menuItem = "rounded-md px-2.5 py-2 text-left text-[13px] hover:bg-line disabled:opacity-40";

/**
 * 멤버 관리 — 가입 신청 승인/거절, 등급 지정, 부리더 지정/해제(리더만), 리더 위임, 제외.
 *
 * 디자인 시안(2026-09) 반영: 필터 칩 → 알약 세그먼트, 행마다 늘어놓던 버튼 4개 →
 * ⋯ 메뉴, 체크박스 다중 선택 + 일괄 등급 변경, CSV 내보내기, 20행 페이지네이션.
 * Supabase 호출(`set_crew_tier`·`set_crew_role`·`transfer_crew_leader`·승인/제외)은
 * 그대로다 — 바뀐 건 화면뿐이다.
 */
export function CrewMemberManage({
  slug,
  crewId,
  myRole,
  myUserId,
  members,
  tiers,
}: {
  slug: string;
  crewId: string;
  myRole: "owner" | "coach";
  myUserId: string;
  members: ManageMember[];
  tiers: CrewTier[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** null = 전체. 'staff' | tier_id | 'none'(등급 없음) */
  const [filter, setFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkTier, setBulkTier] = useState("");
  /** 이력 다이얼로그를 연 멤버 */
  const [history, setHistory] = useState<{ id: string; name: string } | null>(null);

  async function run(key: string, fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(key);
    setErr(null);
    const { error } = await fn();
    setBusy(null);
    if (error) setErr(duesErrText(t, error.message));
    else router.refresh();
  }

  const supabase = () => createClient();
  const approve = (u: string) =>
    run(`a${u}`, () =>
      supabase().from("crew_members").update({ status: "active" }).eq("crew_id", crewId).eq("user_id", u),
    );
  const remove = (u: string, confirmMsg: string) => {
    if (!window.confirm(confirmMsg)) return;
    run(`d${u}`, () =>
      supabase().from("crew_members").delete().eq("crew_id", crewId).eq("user_id", u),
    );
  };
  const setTier = (u: string, tier: string) =>
    run(`g${u}`, () =>
      supabase().rpc("set_crew_tier", { p_slug: slug, p_user: u, p_tier: tier }),
    );
  const setRole = (u: string, role: "coach" | "member" | "associate") =>
    run(`r${u}`, () => supabase().rpc("set_crew_role", { p_slug: slug, p_user: u, p_role: role }));
  const transfer = (u: string) => {
    if (!window.confirm(t("crew.transferConfirm"))) return;
    run(`t${u}`, () => supabase().rpc("transfer_crew_leader", { p_slug: slug, p_user: u }));
  };

  /** 선택한 여러 명의 등급을 한 번에. 일괄 RPC 가 없어 순차로 부른다 —
   *  하나라도 실패하면 거기서 멈추고 그때까지의 변경은 남긴다(되돌리면 더 헷갈린다). */
  async function applyBulk() {
    if (!bulkTier || sel.size === 0) return;
    setBusy("bulk");
    setErr(null);
    const client = createClient();
    for (const u of sel) {
      const { error } = await client.rpc("set_crew_tier", {
        p_slug: slug,
        p_user: u,
        p_tier: bulkTier,
      });
      if (error) {
        setBusy(null);
        return setErr(duesErrText(t, error.message));
      }
    }
    setBusy(null);
    setSel(new Set());
    setBulkTier("");
    router.refresh();
  }

  const roleLabel = (r: string) =>
    r === "owner"
      ? t("crew.roleOwner")
      : r === "coach"
        ? t("crew.roleCoach")
        : r === "associate"
          ? t("crew.roleAssociate")
          : t("crew.roleMember");

  // 검색은 이름과 계정 주소 둘 다 본다 — 이름을 안 넣은 크루원은 이메일로만
  // 찾을 수 있다.
  const q = query.trim().toLowerCase();
  const hit = (m: ManageMember) =>
    !q ||
    m.display_name.toLowerCase().includes(q) ||
    (m.email ?? "").toLowerCase().includes(q);

  const pending = members.filter((m) => m.status === "pending" && hit(m));
  const allActive = members.filter((m) => m.status === "active" && hit(m));
  // 등급 필터 — 운영진(리더·부리더)은 등급이 아니라 권한이라 따로 묶는다.
  const counts = new Map<string, number>();
  for (const m of allActive) {
    const k = isStaffRole(m.role) ? "staff" : (m.tier_id ?? "none");
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const active =
    filter == null
      ? allActive
      : allActive.filter((m) =>
          filter === "staff"
            ? isStaffRole(m.role)
            : !isStaffRole(m.role) && (m.tier_id ?? "none") === filter,
        );
  const chips: { key: string | null; label: string; n: number }[] = [
    { key: null, label: t("crew.filterAll"), n: allActive.length },
    ...(counts.get("staff")
      ? [{ key: "staff", label: t("crew.filterStaff"), n: counts.get("staff")! }]
      : []),
    ...tiers
      .filter((x) => counts.get(x.id))
      .map((x) => ({ key: x.id, label: x.name, n: counts.get(x.id)! })),
    ...(counts.get("none")
      ? [{ key: "none", label: t("crew.filterNoTier"), n: counts.get("none")! }]
      : []),
  ];

  // 필터·검색이 바뀌면 페이지가 범위를 벗어난다 — 효과로 되돌리지 않고 렌더에서 조인다.
  const maxPage = Math.max(1, Math.ceil(active.length / PAGE));
  const cur = Math.min(page, maxPage);
  const rows = active.slice((cur - 1) * PAGE, cur * PAGE);

  const pageSel = rows.filter((m) => sel.has(m.user_id)).length;
  const allPageSel = rows.length > 0 && pageSel === rows.length;
  const toggle = (u: string) =>
    setSel((p) => {
      const next = new Set(p);
      if (next.has(u)) next.delete(u);
      else next.add(u);
      return next;
    });
  const toggleAll = () =>
    setSel((p) => {
      const next = new Set(p);
      if (allPageSel) rows.forEach((m) => next.delete(m.user_id));
      else rows.forEach((m) => next.add(m.user_id));
      return next;
    });

  /** 지금 필터·검색에 걸린 명단을 CSV 로. 서버를 거치지 않고 브라우저에서 만든다. */
  function exportCsv() {
    const head = [
      t("crew.colMember"),
      t("crew.csvEmail"),
      t("crew.colTier"),
      t("crew.csvRole"),
      t("crew.colAttend"),
      t("crew.csvAttendAll"),
    ];
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const body = active.map((m) =>
      [
        m.display_name,
        m.email ?? "",
        m.tier_name ?? "",
        roleLabel(m.role),
        String(m.attend_paid_count),
        String(m.attend_count),
      ]
        .map(esc)
        .join(","),
    );
    // 엑셀이 UTF-8 로 읽게 BOM 을 붙인다 — 없으면 한글이 깨진다
    const blob = new Blob(["﻿" + [head.map(esc).join(","), ...body].join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}-members.csv`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const CARD = "overflow-hidden rounded-[14px] border border-line bg-card";
  const cols =
    "sm:grid sm:grid-cols-[20px_minmax(0,1.6fr)_110px_90px_44px] sm:items-center sm:gap-3";
  const check = "h-4 w-4 shrink-0 cursor-pointer accent-accent";

  return (
    <div className="flex flex-col gap-4">
      {err && (
        <p role="alert" className="text-sm text-danger">
          {err}
        </p>
      )}

      {/* 가입 대기 — 제일 먼저 처리할 일이라 표 위에 따로 둔다 */}
      {pending.length > 0 && (
        <div className="overflow-hidden rounded-[14px] border border-line-accent bg-highlight">
          <p className="border-b border-line-accent px-[18px] py-3 text-[13px] font-extrabold text-gold">
            {t("crew.pendingRequests")} {pending.length}
          </p>
          <ul>
            {pending.map((m) => (
              <li
                key={m.user_id}
                className="flex flex-wrap items-center gap-2.5 border-b border-line-accent/40 px-[18px] py-2.5 last:border-0"
              >
                <Avatar name={m.display_name} size={32} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-bold">{m.display_name}</span>
                  {m.email && <span className="truncate text-[11px] text-muted-3">{m.email}</span>}
                </span>
                <span className="ml-auto flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => approve(m.user_id)}
                    disabled={busy != null}
                    className="h-[30px] rounded-md bg-accent px-3 text-xs font-extrabold text-accent-foreground disabled:opacity-40"
                  >
                    {t("crew.approveMember")}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(m.user_id, t("crew.rejectConfirm"))}
                    disabled={busy != null}
                    className="h-[30px] rounded-md px-2 text-xs text-danger hover:bg-danger-card disabled:opacity-40"
                  >
                    {t("crew.rejectMember")}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={CARD}>
        {/* 툴바 — 좌 세그먼트 / 우 검색·CSV */}
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-[18px] py-3.5">
          <div className="flex flex-wrap gap-1 rounded-full border border-line-mid bg-page p-[3px]">
            {chips.map((c) => {
              const on = filter === c.key;
              return (
                <button
                  key={c.key ?? "all"}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setFilter(c.key);
                    setPage(1);
                  }}
                  className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[13px] font-bold transition-colors ${
                    on ? "bg-accent text-accent-foreground" : "text-foreground-2 hover:text-foreground"
                  }`}
                >
                  {c.label}
                  <span className={`text-[11px] ${on ? "text-gold-line" : "text-muted-3"}`}>
                    {c.n}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              size={1}
              placeholder={t("crew.memberSearch")}
              className="h-[34px] w-[200px] max-w-full min-w-0 rounded-lg border border-line-strong bg-page px-3 text-[13px] outline-none focus:border-accent-line"
            />
            <button
              type="button"
              onClick={exportCsv}
              className="h-[34px] shrink-0 rounded-lg border border-line-strong bg-control px-3 text-[13px] font-semibold hover:border-line-strong"
            >
              ↓ {t("crew.memberCsv")}
            </button>
          </div>
        </div>

        {/* 선택 바 — 고른 사람들의 등급을 한 번에 바꾼다 */}
        {sel.size > 0 && (
          <div className="flex flex-wrap items-center gap-2.5 border-b border-line-accent bg-highlight px-[18px] py-2.5 text-[13px]">
            <strong className="text-gold">{t("crew.memberSelected", { n: sel.size })}</strong>
            <span className="text-muted">{t("crew.memberBulkTier")}</span>
            <select
              value={bulkTier}
              disabled={busy != null}
              onChange={(e) => setBulkTier(e.target.value)}
              className="h-[30px] rounded-md border border-line-accent bg-page px-2 text-[13px] outline-none"
            >
              <option value="">—</option>
              {tiers
                .filter((x) => !x.archived_at)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </select>
            <button
              type="button"
              onClick={() => void applyBulk()}
              disabled={busy != null || !bulkTier}
              className="h-[30px] rounded-md bg-accent px-3 text-[13px] font-extrabold text-accent-foreground disabled:opacity-40"
            >
              {busy === "bulk" ? t("crew.memberApplying") : t("crew.memberApply")}
            </button>
            <button
              type="button"
              onClick={() => setSel(new Set())}
              className="ml-auto text-muted-3 hover:text-foreground"
            >
              {t("crew.memberClearSel")}
            </button>
          </div>
        )}

        {/* 컬럼 머리 — 좁은 화면에서는 행이 카드처럼 쌓여 의미가 없다 */}
        <div
          className={`hidden ${cols} border-b border-line-soft px-[18px] py-2 text-[11px] font-bold tracking-[0.06em] text-muted-3`}
        >
          <input
            type="checkbox"
            checked={allPageSel}
            onChange={toggleAll}
            aria-label={t("crew.memberSelectAll")}
            className={check}
          />
          <span>{t("crew.colMember")}</span>
          <span>{t("crew.colTier")}</span>
          <span className="text-right">{t("crew.colAttend")}</span>
          <span />
        </div>

        {rows.map((m) => {
          const on = sel.has(m.user_id);
          const canPromote = myRole === "owner" && m.user_id !== myUserId && m.role !== "owner";
          return (
            <div
              key={m.user_id}
              className={`${cols} border-b border-line-soft px-[18px] py-2.5 ${
                on ? "bg-highlight" : "hover:bg-card-hover"
              }`}
            >
              <div className="flex min-w-0 items-center gap-2.5 sm:contents">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(m.user_id)}
                  aria-label={m.display_name}
                  className={check}
                />
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={m.display_name} size={36} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-bold">{m.display_name}</span>
                      {isStaffRole(m.role) && (
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-extrabold ${crewRoleBadgeClass(
                            m.role,
                          )}`}
                        >
                          {roleLabel(m.role)}
                        </span>
                      )}
                    </div>
                    {m.email && (
                      <div className="truncate text-[11px] text-muted-3">{m.email}</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-2 flex items-center gap-3 pl-[26px] sm:mt-0 sm:contents">
                {/* 등급 지정 — 등급이 role(정회원/일반회원)까지 맞춘다. 리더는 등급 밖이다. */}
                <select
                  value={m.tier_id ?? ""}
                  aria-label={t("crew.colTier")}
                  disabled={busy != null || m.role === "owner"}
                  onChange={(e) => setTier(m.user_id, e.target.value)}
                  className={`h-[30px] min-w-0 rounded-md border border-line-strong bg-page px-2 text-xs font-bold outline-none focus:border-accent-line disabled:opacity-50 ${tierTextClass(
                    m.tier_color,
                  )}`}
                >
                  {!m.tier_id && <option value="">—</option>}
                  {tiers
                    .filter((x) => !x.archived_at || x.id === m.tier_id)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                </select>

                {/* 출석 = 유료 모임 / 무료 포함 전체 */}
                <span
                  className="tabular text-[13px] sm:text-right"
                  title={t("crew.attendColHint")}
                >
                  <strong>{m.attend_paid_count}</strong>
                  <span className="text-muted-3"> / {m.attend_count}</span>
                </span>

                <RowMenu label={t("crew.memberMenu", { name: m.display_name })}>
                  {(close) => (
                    <>
                      <button
                        type="button"
                        className={`${menuItem} text-foreground`}
                        onClick={() => {
                          close();
                          setHistory({ id: m.user_id, name: m.display_name });
                        }}
                      >
                        {t("crew.memberHistory")}
                      </button>
                      {canPromote && (
                        <>
                          <button
                            type="button"
                            disabled={busy != null}
                            className={`${menuItem} text-foreground`}
                            onClick={() => {
                              close();
                              setRole(m.user_id, m.role === "coach" ? "member" : "coach");
                            }}
                          >
                            {t(m.role === "coach" ? "crew.demoteCoach" : "crew.makeCoach")}
                          </button>
                          <button
                            type="button"
                            disabled={busy != null}
                            className={`${menuItem} text-foreground`}
                            onClick={() => {
                              close();
                              transfer(m.user_id);
                            }}
                          >
                            {t("crew.transferLeader")}…
                          </button>
                        </>
                      )}
                      <span className="my-1 h-px bg-line-mid" />
                      <button
                        type="button"
                        disabled={busy != null || m.role === "owner"}
                        className={`${menuItem} text-danger hover:bg-danger-card`}
                        onClick={() => {
                          close();
                          remove(m.user_id, t("crew.kickConfirm"));
                        }}
                      >
                        {t("crew.kick")}…
                      </button>
                    </>
                  )}
                </RowMenu>
              </div>
            </div>
          );
        })}

        {rows.length === 0 && (
          <p className="px-[18px] py-8 text-center text-[13px] text-muted-3">
            {t("crew.filterEmpty")}
          </p>
        )}

        {/* 푸터 — 몇 명을 보고 있는지 + 페이지 이동 */}
        {active.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-[18px] py-3 text-xs text-muted-3">
            <span>
              {t("crew.memberRange", {
                a: (cur - 1) * PAGE + 1,
                b: Math.min(cur * PAGE, active.length),
                n: active.length,
              })}
            </span>
            {maxPage > 1 && (
              <span className="flex gap-1.5">
                <button
                  type="button"
                  aria-label={t("crew.prevPage")}
                  disabled={cur === 1}
                  onClick={() => setPage(cur - 1)}
                  className="rounded-md border border-line-strong px-2 py-1 disabled:opacity-30"
                >
                  ‹
                </button>
                {Array.from({ length: maxPage }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-current={n === cur}
                    onClick={() => setPage(n)}
                    className={`rounded-md px-2 py-1 ${
                      n === cur
                        ? "bg-accent font-extrabold text-accent-foreground"
                        : "border border-line-strong hover:border-line-strong"
                    }`}
                  >
                    {n}
                  </button>
                ))}
                <button
                  type="button"
                  aria-label={t("crew.nextPage")}
                  disabled={cur === maxPage}
                  onClick={() => setPage(cur + 1)}
                  className="rounded-md border border-line-strong px-2 py-1 disabled:opacity-30"
                >
                  ›
                </button>
              </span>
            )}
          </div>
        )}
      </div>

      {history && (
        <MemberHistory
          slug={slug}
          userId={history.id}
          name={history.name}
          onClose={() => setHistory(null)}
        />
      )}
    </div>
  );
}


type ChangeRow = {
  id: string;
  changed_at: string;
  kind: "join" | "change";
  by_name: string;
  old_tier_name: string | null;
  new_tier_name: string | null;
  old_role: string | null;
  new_role: string | null;
  old_status: string | null;
  new_status: string | null;
};

/** 회원 한 명의 등급·권한·상태 변경 이력.
 *  crew_members 트리거가 쌓고(마이그레이션 103) 운영진만 읽는다. 행 메뉴에서 고른
 *  한 명만 마운트되고, 그때 한 번 받아 온다 — 목록에 회원이 수십 명이라 미리 받아
 *  두면 그만큼 왕복이 늘어난다. */
function MemberHistory({
  slug,
  userId,
  name,
  onClose,
}: {
  slug: string;
  userId: string;
  name: string;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<ChangeRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await createClient().rpc("crew_member_changes_list", {
        p_slug: slug,
        p_user: userId,
        p_limit: 100,
      });
      if (cancelled) return;
      if (error) return setErr(error.message);
      if (data && !Array.isArray(data)) {
        return setErr(String((data as { error?: string }).error ?? "error"));
      }
      setRows((data ?? []) as ChangeRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, userId]);

  const roleLabel = (r: string | null) =>
    r === "owner"
      ? t("crew.roleOwner")
      : r === "coach"
        ? t("crew.roleCoach")
        : r === "associate"
          ? t("crew.roleAssociate")
          : r === "member"
            ? t("crew.roleMember")
            : "—";
  const statusLabel = (v: string | null) =>
    v === "pending"
      ? t("crew.statusPending")
      : v === "blocked"
        ? t("crew.statusBlocked")
        : v === "active"
          ? t("crew.statusActive")
          : "—";
  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <Dialog
        open
        onClose={onClose}
        label={t("crew.memberHistoryTitle", { name })}
        closeLabel={t("common.close")}
        panelClassName="max-w-lg"
      >
        <div className="flex w-full flex-col gap-3 rounded-md bg-surface p-4">
          <p className="text-sm font-semibold">{t("crew.memberHistoryTitle", { name })}</p>
          {err && <p role="alert" className="text-xs text-danger">{err}</p>}
          {rows == null && !err && <p className="text-xs text-muted">…</p>}
          {rows?.length === 0 && (
            <p className="rounded-md bg-background px-3 py-6 text-center text-xs text-muted">
              {t("crew.memberHistoryEmpty")}
            </p>
          )}
          {!!rows?.length && (
            <ol className="flex flex-col gap-2">
              {rows.map((r) => {
                const lines: string[] = [];
                if (r.kind === "join") {
                  lines.push(
                    `${t("crew.memberHistoryJoin")}${r.new_tier_name ? ` · ${r.new_tier_name}` : ""}`,
                  );
                } else {
                  if (r.old_tier_name !== r.new_tier_name) {
                    lines.push(
                      `${t("crew.memberHistoryTier")} ${r.old_tier_name ?? "—"} → ${r.new_tier_name ?? "—"}`,
                    );
                  }
                  if (r.old_role !== r.new_role) {
                    lines.push(
                      `${t("crew.memberHistoryRole")} ${roleLabel(r.old_role)} → ${roleLabel(r.new_role)}`,
                    );
                  }
                  if (r.old_status !== r.new_status) {
                    lines.push(
                      `${t("crew.memberHistoryStatus")} ${statusLabel(r.old_status)} → ${statusLabel(r.new_status)}`,
                    );
                  }
                }
                return (
                  <li key={r.id} className="rounded-md bg-background px-3 py-2">
                    {lines.map((l) => (
                      <p key={l} className="text-sm">
                        {l}
                      </p>
                    ))}
                    <p className="mt-0.5 text-[11px] text-muted">
                      {when(r.changed_at)} ·{" "}
                      {r.by_name
                        ? t("crew.memberHistoryBy", { name: r.by_name })
                        : t("crew.memberHistoryAuto")}
                    </p>
                  </li>
                );
              })}
            </ol>
          )}
          <p className="text-[11px] text-muted">{t("crew.memberHistoryNote")}</p>
          <button
            type="button"
            onClick={onClose}
            className="self-start rounded-md px-3 py-2 text-sm text-muted hover:text-foreground"
          >
            {t("common.close")}
          </button>
        </div>
    </Dialog>
  );
}

/** 크루 삭제 — 리더 전용, 확인 후 삭제하고 목록으로. */
export function CrewDeleteButton({ crewId }: { crewId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function del() {
    if (!window.confirm(t("crew.deleteCrewConfirm"))) return;
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase.from("crews").delete().eq("id", crewId);
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    router.push("/crews");
    router.refresh();
  }

  return (
    <div>
      {err && <p role="alert" className="mb-2 text-sm text-danger">{err}</p>}
      <button
        onClick={del}
        disabled={busy}
        className="rounded-md border border-danger/50 px-4 py-2 text-sm font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
      >
        {t("crew.deleteCrew")}
      </button>
    </div>
  );
}
