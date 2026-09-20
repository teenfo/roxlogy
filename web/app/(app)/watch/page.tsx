import { getT } from "@/lib/i18n";
import { WatchScreen } from "@/components/rox/watch-screen";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("watch.title") };
}

/** 시안 mobile-navigation.tsx 의 WatchScreen — 앱 하단 탭 Watch 가 여는 화면 (PORT_PLAN §7-1) */
export default function WatchPage() {
  return <WatchScreen />;
}
