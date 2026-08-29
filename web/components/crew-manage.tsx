"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";

const input =
  "w-full rounded-md border border-muted/30 bg-background px-3 py-2 text-sm outline-none focus:border-accent";
const label = "mt-4 block text-xs text-muted";

/** 크루 정보 수정 — 크루명·주소는 변경 불가(표시만). 스태프 전용.
 *  소개 화면에 노출되는 항목(운영시간·문의·공식 링크 = links JSONB)까지 전부 여기서 고친다. */
export function CrewInfoForm({
  crew,
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
  const [policy, setPolicy] = useState(links.policy ?? "");
  const [bankAccount, setBankAccount] = useState(links.bank_account ?? "");
  const [joinPolicy, setJoinPolicy] = useState(crew.join_policy);
  const [isPublic, setIsPublic] = useState(crew.is_public);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

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

  return (
    <form onSubmit={save}>
      <label className={label}>{t("crew.fName")}</label>
      <input className={`${input} opacity-50`} value={crew.name} disabled />
      <p className="mt-1 text-xs text-muted">{t("crew.nameLocked")}</p>

      <label className={label}>{t("crew.fSlug")}</label>
      <input className={`${input} opacity-50`} value={`/${crew.slug}`} disabled />

      <label className={label}>{t("crew.fTagline")}</label>
      <input className={input} value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={60} />

      <label className={label}>{t("crew.fDesc")}</label>
      <textarea
        className={`${input} min-h-24`}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={2000}
      />

      <label className={label}>{t("crew.fLocation")}</label>
      <input className={input} value={location} onChange={(e) => setLocation(e.target.value)} maxLength={60} />

      <label className={label}>{t("crew.fHoursWeekday")}</label>
      <input className={input} value={hoursWeekday} onChange={(e) => setHoursWeekday(e.target.value)} maxLength={60} />

      <label className={label}>{t("crew.fHoursWeekend")}</label>
      <input className={input} value={hoursWeekend} onChange={(e) => setHoursWeekend(e.target.value)} maxLength={60} />

      <label className={label}>{t("crew.fPhone")}</label>
      <input className={input} value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={60} />

      <label className={label}>{t("crew.fOfficial")}</label>
      <input
        className={input}
        value={official}
        onChange={(e) => setOfficial(e.target.value)}
        maxLength={200}
        placeholder="https://"
        inputMode="url"
      />

      <label className={label}>{t("crew.fBankAccount")}</label>
      <input
        className={input}
        value={bankAccount}
        onChange={(e) => setBankAccount(e.target.value)}
        maxLength={80}
        placeholder={t("crew.fBankAccountHint")}
      />

      <label className={label}>{t("crew.fRules")}</label>
      <textarea
        className={`${input} min-h-28`}
        value={policy}
        onChange={(e) => setPolicy(e.target.value)}
        maxLength={2000}
        placeholder={t("crew.fRulesHint")}
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
        <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
        {t("crew.fPublic")}
      </label>

      {msg && <p className="mt-3 text-sm text-muted">{msg}</p>}

      <button
        type="submit"
        disabled={busy}
        className="mt-5 rounded-md bg-accent px-5 py-2.5 text-sm font-bold text-background disabled:opacity-50"
      >
        {t("crew.save")}
      </button>
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
  const previewCls =
    kind === "logo"
      ? "h-16 w-16 shrink-0 rounded-md object-cover"
      : "h-24 w-full max-w-72 shrink-0 rounded-md object-cover";

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

  return (
    <div className={kind === "logo" ? "flex items-center gap-4" : "flex flex-col gap-3"}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className={previewCls} />
      ) : (
        <div
          className={`flex items-center justify-center bg-surface text-xs text-muted ${previewCls}`}
        >
          {t(kind === "logo" ? "crew.logoNone" : "crew.coverNone")}
        </div>
      )}
      <div>
        <label className="inline-block cursor-pointer rounded-md bg-surface px-4 py-2 text-sm font-semibold hover:text-accent">
          {busy ? "…" : t(kind === "logo" ? "crew.logoUpload" : "crew.coverUpload")}
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
        {url && (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="ml-3 text-sm text-muted hover:text-red-400 disabled:opacity-50"
          >
            {t("crew.logoRemove")}
          </button>
        )}
        <p className="mt-1.5 text-xs text-muted">
          {t(kind === "logo" ? "crew.logoHint" : "crew.coverHint")}
        </p>
        {err && <p className="mt-1 text-xs text-red-400">{err}</p>}
      </div>
    </div>
  );
}

export type ManageMember = {
  user_id: string;
  display_name: string;
  role: "owner" | "coach" | "member" | "associate";
  status: "pending" | "active" | "blocked";
  joined_at: string;
};

/** 멤버 관리 — 가입 신청 승인/거절, 부리더 지정/해제(리더만), 리더 위임, 제외. */
export function CrewMemberManage({
  slug,
  crewId,
  myRole,
  myUserId,
  members,
}: {
  slug: string;
  crewId: string;
  myRole: "owner" | "coach";
  myUserId: string;
  members: ManageMember[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(key: string, fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(key);
    setErr(null);
    const { error } = await fn();
    setBusy(null);
    if (error) setErr(error.message);
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
  const setRole = (u: string, role: "coach" | "member" | "associate") =>
    run(`r${u}`, () => supabase().rpc("set_crew_role", { p_slug: slug, p_user: u, p_role: role }));
  const transfer = (u: string) => {
    if (!window.confirm(t("crew.transferConfirm"))) return;
    run(`t${u}`, () => supabase().rpc("transfer_crew_leader", { p_slug: slug, p_user: u }));
  };

  const roleLabel = (r: string) =>
    r === "owner"
      ? t("crew.roleOwner")
      : r === "coach"
        ? t("crew.roleCoach")
        : r === "associate"
          ? t("crew.roleAssociate")
          : t("crew.roleMember");

  const pending = members.filter((m) => m.status === "pending");
  const active = members.filter((m) => m.status === "active");
  const btn = "rounded-md px-2.5 py-1 text-xs disabled:opacity-50";

  return (
    <div>
      {err && <p className="mb-3 text-sm text-red-400">{err}</p>}

      {pending.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-muted">
            {t("crew.pendingRequests")} ({pending.length})
          </h3>
          <ul className="mt-2 flex flex-col gap-1.5">
            {pending.map((m) => (
              <li key={m.user_id} className="flex items-center justify-between gap-3 rounded-md bg-surface px-4 py-2.5">
                <span className="truncate text-sm">{m.display_name}</span>
                <span className="flex gap-2">
                  <button
                    onClick={() => approve(m.user_id)}
                    disabled={busy != null}
                    className={`${btn} bg-accent font-bold text-background`}
                  >
                    {t("crew.approveMember")}
                  </button>
                  <button
                    onClick={() => remove(m.user_id, t("crew.rejectConfirm"))}
                    disabled={busy != null}
                    className={`${btn} bg-background text-red-400`}
                  >
                    {t("crew.rejectMember")}
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-5" />
        </>
      )}

      <h3 className="text-sm font-semibold text-muted">
        {t("crew.manageMembers")} ({active.length})
      </h3>
      <ul className="mt-2 flex flex-col gap-1.5">
        {active.map((m) => (
          <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface px-4 py-2.5">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm">{m.display_name}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  m.role === "owner"
                    ? "bg-accent/15 text-accent"
                    : m.role === "coach"
                      ? "bg-track/15 text-track"
                      : "bg-background text-muted"
                }`}
              >
                {roleLabel(m.role)}
              </span>
            </span>
            {myRole === "owner" && m.user_id !== myUserId && m.role !== "owner" && (
              <span className="flex flex-wrap gap-2">
                {m.role === "associate" && (
                  <button
                    onClick={() => setRole(m.user_id, "member")}
                    disabled={busy != null}
                    className={`${btn} bg-background text-accent`}
                  >
                    {t("crew.makeMember")}
                  </button>
                )}
                {m.role === "member" && (
                  <>
                    <button
                      onClick={() => setRole(m.user_id, "coach")}
                      disabled={busy != null}
                      className={`${btn} bg-background text-track`}
                    >
                      {t("crew.makeCoach")}
                    </button>
                    <button
                      onClick={() => setRole(m.user_id, "associate")}
                      disabled={busy != null}
                      className={`${btn} bg-background text-muted`}
                    >
                      {t("crew.toAssociate")}
                    </button>
                  </>
                )}
                {m.role === "coach" && (
                  <button
                    onClick={() => setRole(m.user_id, "member")}
                    disabled={busy != null}
                    className={`${btn} bg-background text-muted`}
                  >
                    {t("crew.demoteCoach")}
                  </button>
                )}
                <button
                  onClick={() => transfer(m.user_id)}
                  disabled={busy != null}
                  className={`${btn} bg-background text-accent`}
                >
                  {t("crew.transferLeader")}
                </button>
                <button
                  onClick={() => remove(m.user_id, t("crew.kickConfirm"))}
                  disabled={busy != null}
                  className={`${btn} bg-background text-red-400`}
                >
                  {t("crew.kick")}
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
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
      {err && <p className="mb-2 text-sm text-red-400">{err}</p>}
      <button
        onClick={del}
        disabled={busy}
        className="rounded-md border border-red-400/50 px-4 py-2 text-sm font-semibold text-red-400 hover:bg-red-400/10 disabled:opacity-50"
      >
        {t("crew.deleteCrew")}
      </button>
    </div>
  );
}
