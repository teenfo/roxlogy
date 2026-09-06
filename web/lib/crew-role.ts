import type { DictKey } from "@/lib/i18n/dictionaries/en";

export type CrewRoleKey = "owner" | "coach" | "member" | "associate";

/** 등급 정렬 순서 — 리더 · 부리더 · 정회원 · 일반회원. DB(crew_roster·
 *  crew_manage_roster)와 같은 순서를 쓴다. 클라이언트에서 다시 정렬해야 할
 *  때만 쓰고, 서버가 정렬해 준 목록은 그대로 둔다. */
export const CREW_ROLE_ORDER: CrewRoleKey[] = [
  "owner",
  "coach",
  "member",
  "associate",
];

export function crewRoleRank(role: string): number {
  const i = CREW_ROLE_ORDER.indexOf(role as CrewRoleKey);
  return i < 0 ? CREW_ROLE_ORDER.length : i;
}

/** 등급 뱃지 색 — 네 등급이 서로 구분돼야 한다.
 *  리더=옐로(accent) / 부리더=블루(track) / 정회원=밝은 중립 / 일반회원=흐린 중립 */
export function crewRoleBadgeClass(role: string): string {
  switch (role) {
    case "owner":
      return "bg-accent/15 text-accent ring-1 ring-accent/40";
    case "coach":
      return "bg-track/15 text-track ring-1 ring-track/40";
    case "member":
      return "bg-foreground/10 text-foreground/80 ring-1 ring-foreground/15";
    default: // associate
      return "bg-background text-muted ring-1 ring-muted/25";
  }
}

/** 사전 키 — crew.role.owner / .coach / .member / .associate */
export function crewRoleDictKey(role: string): DictKey {
  return `crew.role.${
    CREW_ROLE_ORDER.includes(role as CrewRoleKey) ? role : "member"
  }` as DictKey;
}
