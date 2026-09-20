import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCachedProfile, getCachedUser } from "@/lib/supabase/auth";

/** 사이드바 푸터 "내 크루" */
export type ShellCrew = {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  location: string | null;
};

export type ShellData = {
  user: { id: string } | null;
  displayName: string;
  isAdmin: boolean;
  unread: number;
  crew: ShellCrew | null;
  /** 설정에서 고를 수 있는 내 크루 전부(활성 회원인 곳) */
  crews: ShellCrew[];
  /** profiles.sidebar_crew_id — 설정에서 고른 크루. null = 자동 */
  pinned: string | null;
};

type MembershipRow = {
  joined_at: string;
  crew: ShellCrew & { id: string; status: string } | null;
};

/**
 * 앱 셸(사이드바·상단바)이 쓰는 요청 단위 데이터. 같은 요청에서 여러 번 불러도
 * 조회는 한 번이다(react cache). 프로필·알림 수·크루 소속을 **한 번의 Promise.all**
 * 로 받는다 — 레이아웃이 왕복을 늘리지 않게(CLAUDE.md 성능 규칙).
 *
 * "내 크루"는 profiles.sidebar_crew_id(설정에서 고른 것)가 있으면 그것, 없으면
 * 가장 오래 가입한 활성 크루다(PORT_PLAN §7-5).
 */
export const getShellData = cache(async (): Promise<ShellData> => {
  const user = await getCachedUser();
  if (!user) {
    return { user: null, displayName: "", isAdmin: false, unread: 0, crew: null, crews: [], pinned: null };
  }
  const supabase = await createClient();
  const [profile, unreadRes, memberRes] = await Promise.all([
    getCachedProfile(),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null),
    supabase
      .from("crew_members")
      .select("joined_at, crew:crews(id, slug, name, logo_url, location, status)")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("joined_at", { ascending: true }),
  ]);

  const rows = (memberRes.error ? [] : (memberRes.data ?? [])) as unknown as MembershipRow[];
  const crews = rows
    .map((r) => r.crew)
    .filter((c): c is NonNullable<MembershipRow["crew"]> => !!c && c.status === "active")
    .map(({ id, slug, name, logo_url, location }) => ({ id, slug, name, logo_url, location }));

  const pinned = (profile as { sidebar_crew_id?: string | null } | null)?.sidebar_crew_id ?? null;
  const picked = (pinned && crews.find((c) => c.id === pinned)) || crews[0] || null;

  return {
    user: { id: user.id },
    displayName: profile?.display_name ?? "Athlete",
    isAdmin: profile?.is_admin === true,
    unread: unreadRes.error ? 0 : (unreadRes.count ?? 0),
    crew: picked,
    crews,
    pinned,
  };
});
