/** 크루 도메인의 순수 타입·상수 — 클라이언트 컴포넌트에서도 안전하게 import 가능하도록
 *  서버 전용 모듈(lib/supabase/server → next/headers)과 분리해 둔다. */

export const POST_CATEGORIES = [
  "notice",
  "free",
  "wod",
  "review",
  "recruit",
  "question",
] as const;
export type PostCategory = (typeof POST_CATEGORIES)[number];

export type CrewRole = "owner" | "coach" | "member" | "associate";
export type CrewStatus = "pending" | "active" | "blocked";

export type CrewOverview = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  logo_url: string | null;
  cover_url: string | null;
  location: string | null;
  home_gym: string | null;
  links: Record<string, string>;
  member_count: number;
  post_count: number;
  upcoming_count: number;
  my_role: CrewRole | null;
  my_status: CrewStatus | null;
  crew_status: "pending" | "active" | "rejected";
};

export type CrewPost = {
  id: string;
  category: PostCategory;
  title: string;
  body: string | null;
  image_urls: string[] | null;
  author_id: string;
  author_name: string;
  author_division: string | null;
  pinned: boolean;
  comment_count: number;
  like_count: number;
  liked_by_me: boolean;
  created_at: string;
};

export type CrewComment = {
  id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
};

export type CrewPostDetail = Omit<CrewPost, "author_division"> & {
  comments: CrewComment[];
};

export type CrewDirectoryRow = {
  slug: string;
  name: string;
  tagline: string | null;
  logo_url: string | null;
  location: string | null;
  join_policy: "open" | "approval" | "invite";
  member_count: number;
  post_count: number;
};

export type CrewRankRow = {
  rank: number;
  user_id: string;
  display_name: string;
  division: string | null;
  best_ms: number | null;
  session_count: number;
  last_at: string | null;
};

export type CrewMemberRow = {
  user_id: string;
  display_name: string;
  division: string | null;
  role: CrewRole;
  joined_at: string;
  session_count: number;
};

/** 멤버(active)인지 — 글쓰기·RSVP 권한 판정 */
export function isActiveMember(crew: CrewOverview): boolean {
  return crew.my_status === "active";
}
