/**
 * 이니셜 아바타 색.
 *
 * 예전에는 `components/ui/crew-ui.tsx` 와 `lib/pft-race.ts` 에 팔레트와 해시가
 * 따로 있었고, 팔레트가 이미 `#ffd500`/`#ffd60a` 로 어긋나 있었다. 해시도 서로
 * 달라서 **같은 사람이 크루 화면과 PFT 보드에서 다른 색**으로 나왔다.
 * "같은 사람은 늘 같은 색" 이 아바타 색의 존재 이유이므로 하나로 합친다.
 *
 * 값은 CSS 변수로 둔다 — 인라인 style·SVG 어디에 넣어도 테마를 따라온다.
 */
export const AVATAR_COLORS = [
  "var(--accent)",
  "var(--warn)",
  "var(--cat-sky)",
  "var(--cat-lime)",
  "var(--cat-violet)",
  "var(--cat-pink)",
] as const;

export function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
