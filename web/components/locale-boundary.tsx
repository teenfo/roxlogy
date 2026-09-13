import { getDict, getT } from "@/lib/i18n";
import { I18nProvider } from "@/components/i18n-provider";

/**
 * 로케일 경계 — **Suspense 안**에서 쿠키를 읽어 번역 공급자를 세운다.
 *
 * 왜 루트 레이아웃이 아니라 여기인가:
 * cacheComponents(PPR)에서 루트 레이아웃이 쿠키를 읽으면 정적 셸이 만들어지지 않는다.
 * 그렇다고 셸에서 기본 로케일로 공급자를 세우고 브라우저에서 사전을 바꾸면, 셸이 먼저
 * 하이드레이션되어 언어를 바꾼 뒤 **스트리밍된 본문이 옛 언어 HTML 로 하이드레이션되어**
 * 텍스트가 어긋난다(React #418, 2026-09-13 실제 발생).
 *
 * 이 컴포넌트는 Suspense 안에 있어 쿠키를 읽어도 셸이 정적으로 남고, 서버와 클라이언트가
 * 처음부터 같은 사전을 본다 — 교체가 없으니 불일치도 없다.
 */
export async function LocaleBoundary({ children }: { children: React.ReactNode }) {
  const { locale } = await getT();
  return (
    <I18nProvider locale={locale} dict={getDict(locale)}>
      {children}
    </I18nProvider>
  );
}
