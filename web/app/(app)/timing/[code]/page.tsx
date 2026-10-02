// 타임체크 메뉴의 선수 화면 — PFT 레이스와 같은 페이지를 주소만 달리해 쓴다.
// 탭 제목만 타임체크 이름으로 바꾼다(본문은 레이스 종목으로 갈린다).
import { getT } from "@/lib/i18n";
export { default } from "@/app/(app)/pft/race/[code]/page";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { t } = await getT();
  return { title: `${t("timing.title")} ${code.toUpperCase()}` };
}
