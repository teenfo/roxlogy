"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Download, ImageIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { crewRoleChipTone, isStaffRole, tierChipTone } from "@/lib/crew-role";
import { downloadCSV } from "@/lib/won";
import type { CrewTier } from "@/components/crew-tier-manage";
import { duesErrText } from "@/lib/dues-error";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { RoxDialog } from "@/components/rox/dialog";
import { Person } from "@/components/rox/person";
import { RowMenu } from "@/components/crew-ledger-table";
import { Chip, Choice, DataTable, Empty, Field, Find, Hint, Panel, Segments } from "@/components/rox/ui";

/**
 * 크루 정보 수정 — 크루명·주소는 변경 불가(표시만). 스태프 전용.
 * 소개 화면에 노출되는 항목(운영시간·문의·공식 링크 = links JSONB)까지 전부 여기서 고친다.
 *
 * 시안 crew.tsx Manage(기본 정보) 그대로 (PORT_PLAN §3-e): form[ Panel "크루 기본 정보"(.rx-form-grid ·
 * Textarea 소개 · Choice 가입 방식 · .rx-switch-row 공개 크루 · 버튼 · Hint) ]. 브랜딩·활동 정보·크루원 전용 칸과
 * 우측 미리보기는 우리 것이라 같은 Panel·Field 로만 더한다(§4). Supabase 업데이트는 그대로 — links 는 키를 보존해 덮어쓴다.
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

  // 저장 버튼이 "변경 사항 없음"을 정확히 말하려면 원본과 비교해야 한다.
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

  const policyLabel = (p: string) =>
    t(p === "open" ? "crew.policyOpen" : p === "approval" ? "crew.policyApproval" : "crew.policyInvite");
  const policyTone = joinPolicy === "open" ? "green" : joinPolicy === "approval" ? "blue" : "neutral";

  return (
    <form onSubmit={save} className="rx-form-layout">
      <div>
        {/* 1. 브랜딩 — 업로드는 저장 버튼과 무관하게 즉시 반영된다 */}
        <Panel title={t("crew.infoBranding")}>
          <div className="rx-actions" style={{ alignItems: "flex-start" }}>
            <CrewImageUpload crewId={crew.id} url={logoUrl} kind="logo" />
            <CrewImageUpload crewId={crew.id} url={coverUrl} kind="cover" />
          </div>
        </Panel>

        {/* 2. 기본 정보 — 시안의 "크루 기본 정보" 패널 */}
        <Panel title={t("crew.infoBasic")}>
          <div className="rx-form-grid">
            <Field label={t("crew.fName")}>
              <Input value={crew.name} disabled />
            </Field>
            <Field label={t("crew.fSlug")}>
              <Input value={`roxlogy.com/crews/${crew.slug}`} disabled />
            </Field>
            <Field label={t("crew.fLocation")}>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={60} />
            </Field>
            <Field label={t("crew.fHoursWeekday")}>
              <Input placeholder={t("crew.hoursPh")} value={hoursWeekday} onChange={(e) => setHoursWeekday(e.target.value)} maxLength={60} />
            </Field>
          </div>
          <Hint>{t("crew.nameLocked")}</Hint>
          <Field label={`${t("crew.fTagline")} · ${tagline.length}/60`}>
            <Input value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={60} />
          </Field>
          <Field label={t("crew.fDesc")}>
            <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
          </Field>
          <Field label={t("crew.fPolicy")}>
            <Choice
              label={t("crew.fPolicy")}
              value={joinPolicy}
              onChange={(v) => setJoinPolicy(v as typeof joinPolicy)}
              options={[
                ["open", `${t("crew.policyOpen")} · ${t("crew.policyOpenDesc")}`],
                ["approval", `${t("crew.policyApproval")} · ${t("crew.policyApprovalDesc")}`],
                ["invite", `${t("crew.policyInvite")} · ${t("crew.policyInviteDesc")}`],
              ]}
            />
          </Field>
          <label className="rx-switch-row">
            <span>
              <b>{t("crew.fPublicShort")}</b>
              <small>{t("crew.fPublicDesc")}</small>
            </span>
            <Switch checked={isPublic} onCheckedChange={setIsPublic} aria-label={t("crew.fPublicShort")} />
          </label>
        </Panel>

        {/* 3. 활동 정보 */}
        <Panel title={t("crew.infoActivity")}>
          <div className="rx-form-grid">
            <Field label={t("crew.fHoursWeekend")}>
              <Input placeholder={t("crew.hoursPh")} value={hoursWeekend} onChange={(e) => setHoursWeekend(e.target.value)} maxLength={60} />
            </Field>
            <Field label={t("crew.fPhone")}>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={60} />
            </Field>
          </div>
          <Field label={t("crew.fOfficial")}>
            <Input value={official} onChange={(e) => setOfficial(e.target.value)} maxLength={200} placeholder="https://" inputMode="url" />
          </Field>
        </Panel>

        {/* 4. 크루원 전용 — 소개 탭에서 크루원에게만 보이는 항목 */}
        <Panel title={t("crew.infoMembersOnly")} action={<Chip tone="blue">{t("crew.membersOnlyBadge")}</Chip>}>
          <Field label={t("crew.fPhotos")}>
            <Input value={photos} onChange={(e) => setPhotos(e.target.value)} maxLength={500} placeholder="https://photos.app.goo.gl/..." inputMode="url" />
          </Field>
          <Hint>{t("crew.fPhotosHint")}</Hint>
          <Field label={t("crew.fBankAccount")}>
            <Input value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} maxLength={80} placeholder={t("crew.fBankAccountHint")} />
          </Field>
          <Field label={t("crew.fRules")}>
            <Textarea rows={4} value={policy} onChange={(e) => setPolicy(e.target.value)} maxLength={2000} />
          </Field>
          <Hint>{t("crew.fRulesHint")}</Hint>
          <div className="rx-actions">
            <Button type="submit" className="rx-primary" disabled={busy || !dirty}>
              {busy ? t("common.saving") : t("crew.save")}
            </Button>
            {dirty && (
              <Button type="button" variant="outline" onClick={revert} disabled={busy}>
                {t("crew.revert")}
              </Button>
            )}
            <span className="rx-muted">{dirty ? t("crew.unsavedN", { n: dirtyCount }) : (msg ?? t("crew.noChanges"))}</span>
          </div>
        </Panel>
      </div>

      {/* 우측 — 목록 카드 미리보기. 저장 전 값으로 그려 고치는 즉시 보이게 한다 */}
      <aside>
        <Panel title={t("crew.preview")}>
          <div className="rx-person">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="rx-avatar" style={{ objectFit: "cover" }} />
            ) : (
              <span className="rx-avatar" aria-hidden>
                {crew.name[0]}
              </span>
            )}
            <span style={{ minWidth: 0 }}>
              <b>{crew.name}</b>
              <small>{[location, hoursWeekend || hoursWeekday].filter(Boolean).join(" · ") || "—"}</small>
            </span>
            <Chip tone={policyTone}>{policyLabel(joinPolicy)}</Chip>
          </div>
          <p className="rx-muted" style={{ marginTop: 14 }}>
            {description || tagline || t("crew.previewNoDesc")}
          </p>
          <div className="rx-actions">
            <Chip>
              {memberCount} {t("crew.memberUnit")}
            </Chip>
            <Chip>
              {postCount} {t("crew.postUnit")}
            </Chip>
            <Chip tone={isPublic ? "green" : "neutral"}>{t(isPublic ? "crew.previewPublic" : "crew.previewPrivate")}</Chip>
          </div>
          <Hint>
            <Link href={`/crews/${crew.slug}`}>{t("crew.openCrewPage")}</Link>
          </Hint>
        </Panel>
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
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", quality));
    if (blob && blob.size <= 2 * 1024 * 1024) return blob;
  }
  throw new Error("image too large after resize");
}

/**
 * 크루 이미지(로고·커버) 업로드 — 스태프 전용. crew-logos/<crewId>/<kind> 에
 * 업서트하고 해당 컬럼에 캐시버스터(?v=) 붙인 공개 URL 을 저장한다.
 * 시안에는 없는 기능(§4) — 시안 프로필 편집(.rx-profile-editor: 아바타 + 버튼)의 모양을 빌린다.
 * 폼의 저장 버튼과 무관하게 **고르는 즉시 저장**된다.
 */
export function CrewImageUpload({ crewId, url, kind }: { crewId: string; url: string | null; kind: "logo" | "cover" }) {
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
      const { error: upErr } = await supabase.storage.from("crew-logos").upload(path, blob, { upsert: true, contentType: "image/webp" });
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

  const pickLabel = t(kind === "logo" ? "crew.logoEdit" : "crew.coverChange");
  const fileInput = (
    <input
      type="file"
      accept="image/*"
      hidden
      disabled={busy}
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) upload(f);
        e.target.value = "";
      }}
    />
  );
  const isLogo = kind === "logo";

  return (
    <div className="rx-profile-editor" style={{ margin: 0, flex: isLogo ? "0 0 auto" : "1 1 260px", alignItems: isLogo ? "center" : "flex-start", flexDirection: isLogo ? "row" : "column" }}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          className={isLogo ? "rx-avatar" : undefined}
          style={isLogo ? { objectFit: "cover" } : { width: "100%", height: 120, objectFit: "cover", borderRadius: 10, border: "1px solid #dfe5eb" }}
        />
      ) : (
        <span
          className={isLogo ? "rx-avatar" : undefined}
          style={isLogo ? undefined : { display: "grid", placeItems: "center", width: "100%", height: 120, borderRadius: 10, border: "1px dashed #d7dce5", color: "#87919e", fontSize: 13 }}
        >
          {busy ? "…" : isLogo ? <ImageIcon size={24} aria-label={t("crew.logoNone")} /> : t("crew.coverNone")}
        </span>
      )}
      <div>
        <div className="rx-actions" style={{ marginTop: 0 }}>
          <Button asChild variant="outline" size="sm">
            <label style={{ cursor: busy ? "wait" : "pointer" }}>
              {pickLabel}
              {fileInput}
            </label>
          </Button>
          {url && (
            <Button type="button" variant="ghost" size="sm" onClick={remove} disabled={busy}>
              {t("crew.logoRemove")}
            </Button>
          )}
        </div>
        <Hint>{t(isLogo ? "crew.logoSquareHint" : "crew.coverBannerHint")}</Hint>
        {err && (
          <p role="alert" className="rx-error">
            {err}
          </p>
        )}
      </div>
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

/**
 * 멤버 관리 — 가입 신청 승인/거절, 등급 지정, 부리더 지정/해제(리더만), 리더 위임, 제외.
 *
 * 시안 crew.tsx MemberList 그대로 (PORT_PLAN §3-e): Panel[ .rx-toolbar(Find · Choice) · DataTable[멤버 · 회원 구분 · …] ·
 * Empty · Hint ]. 가입 대기 Panel·체크박스 다중 선택·일괄 등급·CSV·⋯ 행 메뉴·페이지네이션은 우리 것(§4) —
 * Segments·Checkbox·RowMenu 로만 더한다. Supabase 호출(`set_crew_tier`·`set_crew_role`·`transfer_crew_leader`·승인/제외)은 그대로다.
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
  /** 'all' | 'staff' | tier_id | 'none'(등급 없음) */
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkTier, setBulkTier] = useState("none");
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
    run(`a${u}`, () => supabase().from("crew_members").update({ status: "active" }).eq("crew_id", crewId).eq("user_id", u));
  const remove = (u: string, confirmMsg: string) => {
    if (!window.confirm(confirmMsg)) return;
    run(`d${u}`, () => supabase().from("crew_members").delete().eq("crew_id", crewId).eq("user_id", u));
  };
  const setTier = (u: string, tier: string) => run(`g${u}`, () => supabase().rpc("set_crew_tier", { p_slug: slug, p_user: u, p_tier: tier }));
  const setRole = (u: string, role: "coach" | "member" | "associate") =>
    run(`r${u}`, () => supabase().rpc("set_crew_role", { p_slug: slug, p_user: u, p_role: role }));
  const transfer = (u: string) => {
    if (!window.confirm(t("crew.transferConfirm"))) return;
    run(`t${u}`, () => supabase().rpc("transfer_crew_leader", { p_slug: slug, p_user: u }));
  };

  /** 선택한 여러 명의 등급을 한 번에. 일괄 RPC 가 없어 순차로 부른다 —
   *  하나라도 실패하면 거기서 멈추고 그때까지의 변경은 남긴다(되돌리면 더 헷갈린다). */
  async function applyBulk() {
    if (bulkTier === "none" || sel.size === 0) return;
    setBusy("bulk");
    setErr(null);
    const client = createClient();
    for (const u of sel) {
      const { error } = await client.rpc("set_crew_tier", { p_slug: slug, p_user: u, p_tier: bulkTier });
      if (error) {
        setBusy(null);
        return setErr(duesErrText(t, error.message));
      }
    }
    setBusy(null);
    setSel(new Set());
    setBulkTier("none");
    router.refresh();
  }

  const roleLabel = (r: string) =>
    r === "owner" ? t("crew.roleOwner") : r === "coach" ? t("crew.roleCoach") : r === "associate" ? t("crew.roleAssociate") : t("crew.roleMember");

  // 검색은 이름과 계정 주소 둘 다 본다 — 이름을 안 넣은 크루원은 이메일로만 찾을 수 있다.
  const q = query.trim().toLowerCase();
  const hit = (m: ManageMember) => !q || m.display_name.toLowerCase().includes(q) || (m.email ?? "").toLowerCase().includes(q);

  const pending = members.filter((m) => m.status === "pending" && hit(m));
  const allActive = members.filter((m) => m.status === "active" && hit(m));
  // 등급 필터 — 운영진(리더·부리더)은 등급이 아니라 권한이라 따로 묶는다.
  const counts = new Map<string, number>();
  for (const m of allActive) {
    const k = isStaffRole(m.role) ? "staff" : (m.tier_id ?? "none");
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const active =
    filter === "all" ? allActive : allActive.filter((m) => (filter === "staff" ? isStaffRole(m.role) : !isStaffRole(m.role) && (m.tier_id ?? "none") === filter));
  const segments: [string, string][] = [
    ["all", `${t("crew.filterAll")} ${allActive.length}`],
    ...(counts.get("staff") ? [["staff", `${t("crew.filterStaff")} ${counts.get("staff")}`] as [string, string]] : []),
    ...tiers.filter((x) => counts.get(x.id)).map((x) => [x.id, `${x.name} ${counts.get(x.id)}`] as [string, string]),
    ...(counts.get("none") ? [["none", `${t("crew.filterNoTier")} ${counts.get("none")}`] as [string, string]] : []),
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
    downloadCSV(
      `${slug}-members.csv`,
      [t("crew.colMember"), t("crew.csvEmail"), t("crew.colTier"), t("crew.csvRole"), t("crew.colAttend"), t("crew.csvAttendAll")],
      active.map((m) => [m.display_name, m.email ?? "", m.tier_name ?? "", roleLabel(m.role), String(m.attend_paid_count), String(m.attend_count)]),
    );
  }

  const activeTiers = tiers.filter((x) => !x.archived_at);

  return (
    <>
      {err && (
        <p role="alert" className="rx-error">
          {err}
        </p>
      )}

      {/* 가입 대기 — 제일 먼저 처리할 일이라 표 위에 따로 둔다 */}
      {pending.length > 0 && (
        <Panel title={t("crew.pendingRequests")} action={<Chip tone="yellow">{pending.length}</Chip>}>
          <DataTable
            headers={[t("crew.colMember"), ""]}
            rows={pending.map((m) => [
              <Person key="p" name={m.display_name} note={m.email} />,
              <span key="a" className="rx-actions" style={{ marginTop: 0, justifyContent: "flex-end", flexWrap: "nowrap" }}>
                <Button size="sm" className="rx-primary" type="button" onClick={() => approve(m.user_id)} disabled={busy != null}>
                  {t("crew.approveMember")}
                </Button>
                <Button size="sm" variant="ghost" type="button" className="rx-pft-close" onClick={() => remove(m.user_id, t("crew.rejectConfirm"))} disabled={busy != null}>
                  {t("crew.rejectMember")}
                </Button>
              </span>,
            ])}
          />
        </Panel>
      )}

      <Panel>
        <div className="rx-toolbar">
          <Segments
            label={t("crew.colTier")}
            value={filter}
            onChange={(v) => {
              setFilter(v);
              setPage(1);
            }}
            options={segments}
          />
          <div className="rx-actions" style={{ marginTop: 0 }}>
            <Find
              value={query}
              onChange={(v) => {
                setQuery(v);
                setPage(1);
              }}
              placeholder={t("crew.memberSearch")}
            />
            <Button type="button" variant="outline" onClick={exportCsv}>
              <Download size={16} />
              {t("crew.memberCsv")}
            </Button>
          </div>
        </div>

        {/* 선택 바 — 고른 사람들의 등급을 한 번에 바꾼다 */}
        <div className="rx-actions" style={{ marginTop: 0, marginBottom: 12 }}>
          <label className="rx-check" style={{ margin: 0 }}>
            <Checkbox checked={allPageSel} onCheckedChange={toggleAll} aria-label={t("crew.memberSelectAll")} />
            {t("crew.memberSelectAll")}
          </label>
          {sel.size > 0 && (
            <>
              <strong>{t("crew.memberSelected", { n: sel.size })}</strong>
              <Choice
                label={t("crew.memberBulkTier")}
                value={bulkTier}
                onChange={setBulkTier}
                options={[["none", t("crew.memberBulkTier")], ...activeTiers.map((x) => [x.id, x.name] as [string, string])]}
              />
              <Button type="button" size="sm" className="rx-primary" onClick={() => void applyBulk()} disabled={busy != null || bulkTier === "none"}>
                {busy === "bulk" ? t("crew.memberApplying") : t("crew.memberApply")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setSel(new Set())}>
                {t("crew.memberClearSel")}
              </Button>
            </>
          )}
        </div>

        <DataTable
          headers={["", t("crew.colMember"), t("crew.colTier"), t("crew.colAttend"), ""]}
          rows={rows.map((m) => {
            const canPromote = myRole === "owner" && m.user_id !== myUserId && m.role !== "owner";
            return [
              <Checkbox key="c" checked={sel.has(m.user_id)} onCheckedChange={() => toggle(m.user_id)} aria-label={m.display_name} />,
              <Person
                key="p"
                name={m.display_name}
                note={m.email}
                chip={isStaffRole(m.role) ? <Chip tone={crewRoleChipTone(m.role)}>{roleLabel(m.role)}</Chip> : undefined}
              />,
              // 등급 지정 — 등급이 role(정회원/일반회원)까지 맞춘다. 리더는 등급 밖이다.
              m.role === "owner" ? (
                <Chip key="t">{t("crew.roleOwner")}</Chip>
              ) : (
                <span key="t" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  {m.tier_id && <Chip tone={tierChipTone(m.tier_color)}>{m.tier_name}</Chip>}
                  <Choice
                    label={t("crew.colTier")}
                    value={m.tier_id ?? "none"}
                    onChange={(v) => v !== "none" && setTier(m.user_id, v)}
                    options={[
                      ...(!m.tier_id ? [["none", "—"] as [string, string]] : []),
                      ...tiers.filter((x) => !x.archived_at || x.id === m.tier_id).map((x) => [x.id, x.name] as [string, string]),
                    ]}
                  />
                </span>
              ),
              // 출석 = 유료 모임 / 무료 포함 전체
              <span key="n" className="rx-number" title={t("crew.attendColHint")}>
                <strong>{m.attend_paid_count}</strong>
                <small className="rx-muted"> / {m.attend_count}</small>
              </span>,
              <RowMenu key="m" label={t("crew.memberMenu", { name: m.display_name })}>
                <Button variant="ghost" size="sm" type="button" onClick={() => setHistory({ id: m.user_id, name: m.display_name })}>
                  {t("crew.memberHistory")}
                </Button>
                {canPromote && (
                  <>
                    <Button variant="ghost" size="sm" type="button" disabled={busy != null} onClick={() => setRole(m.user_id, m.role === "coach" ? "member" : "coach")}>
                      {t(m.role === "coach" ? "crew.demoteCoach" : "crew.makeCoach")}
                    </Button>
                    <Button variant="ghost" size="sm" type="button" disabled={busy != null} onClick={() => transfer(m.user_id)}>
                      {t("crew.transferLeader")}…
                    </Button>
                  </>
                )}
                <Button variant="ghost" size="sm" type="button" className="rx-pft-close" disabled={busy != null || m.role === "owner"} onClick={() => remove(m.user_id, t("crew.kickConfirm"))}>
                  {t("crew.kick")}…
                </Button>
              </RowMenu>,
            ];
          })}
        />
        {rows.length === 0 && <Empty title={t("crew.filterEmpty")} description={t("crew.memberSearch")} />}

        {/* 푸터 — 몇 명을 보고 있는지 + 페이지 이동 */}
        {active.length > 0 && (
          <div className="rx-actions">
            <span className="rx-muted">{t("crew.memberRange", { a: (cur - 1) * PAGE + 1, b: Math.min(cur * PAGE, active.length), n: active.length })}</span>
            {maxPage > 1 && (
              <>
                <Button type="button" variant="outline" size="sm" aria-label={t("crew.prevPage")} disabled={cur === 1} onClick={() => setPage(cur - 1)}>
                  ‹
                </Button>
                {Array.from({ length: maxPage }, (_, i) => i + 1).map((n) => (
                  <Button key={n} type="button" size="sm" variant={n === cur ? "default" : "outline"} className={n === cur ? "rx-primary" : ""} aria-current={n === cur} onClick={() => setPage(n)}>
                    {n}
                  </Button>
                ))}
                <Button type="button" variant="outline" size="sm" aria-label={t("crew.nextPage")} disabled={cur === maxPage} onClick={() => setPage(cur + 1)}>
                  ›
                </Button>
              </>
            )}
          </div>
        )}
      </Panel>

      {history && <MemberHistory slug={slug} userId={history.id} name={history.name} onClose={() => setHistory(null)} />}
    </>
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
 *  두면 그만큼 왕복이 늘어난다. 시안에 없는 화면(§4) — RoxDialog + DataTable 로만 그린다. */
function MemberHistory({ slug, userId, name, onClose }: { slug: string; userId: string; name: string; onClose: () => void }) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<ChangeRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await createClient().rpc("crew_member_changes_list", { p_slug: slug, p_user: userId, p_limit: 100 });
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
    v === "pending" ? t("crew.statusPending") : v === "blocked" ? t("crew.statusBlocked") : v === "active" ? t("crew.statusActive") : "—";
  const when = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <RoxDialog open onOpenChange={(o) => !o && onClose()} title={t("crew.memberHistoryTitle", { name })} description={t("crew.memberHistoryNote")}>
      {err && (
        <p role="alert" className="rx-error">
          {err}
        </p>
      )}
      {rows == null && !err && <p className="rx-muted">…</p>}
      {rows?.length === 0 && <Empty title={t("crew.memberHistoryEmpty")} description={t("crew.memberHistoryNote")} />}
      {!!rows?.length && (
        <DataTable
          headers={[t("crew.memberHistory"), t("crew.memberHistoryBy", { name: "" }).trim() || "—"]}
          rows={rows.map((r) => {
            const lines: string[] = [];
            if (r.kind === "join") {
              lines.push(`${t("crew.memberHistoryJoin")}${r.new_tier_name ? ` · ${r.new_tier_name}` : ""}`);
            } else {
              if (r.old_tier_name !== r.new_tier_name) lines.push(`${t("crew.memberHistoryTier")} ${r.old_tier_name ?? "—"} → ${r.new_tier_name ?? "—"}`);
              if (r.old_role !== r.new_role) lines.push(`${t("crew.memberHistoryRole")} ${roleLabel(r.old_role)} → ${roleLabel(r.new_role)}`);
              if (r.old_status !== r.new_status) lines.push(`${t("crew.memberHistoryStatus")} ${statusLabel(r.old_status)} → ${statusLabel(r.new_status)}`);
            }
            return [
              <span key="l">
                {lines.map((l) => (
                  <span key={l} style={{ display: "block" }}>
                    {l}
                  </span>
                ))}
              </span>,
              <small key="w" className="rx-muted">
                {when(r.changed_at)}
                <br />
                {r.by_name ? t("crew.memberHistoryBy", { name: r.by_name }) : t("crew.memberHistoryAuto")}
              </small>,
            ];
          })}
        />
      )}
      <div className="rx-actions">
        <Button type="button" variant="outline" onClick={onClose}>
          {t("common.close")}
        </Button>
      </div>
    </RoxDialog>
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
      {err && (
        <p role="alert" className="rx-error">
          {err}
        </p>
      )}
      <Button type="button" variant="outline" className="rx-pft-close" onClick={del} disabled={busy}>
        {t("crew.deleteCrew")}
      </Button>
    </div>
  );
}
