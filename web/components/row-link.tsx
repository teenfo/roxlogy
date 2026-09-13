"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";

/**
 * 목록의 행 링크 — **뷰포트 프리페치는 끄고, 누를 뜻을 보였을 때만 미리 받는다.**
 *
 * 왜 이 컴포넌트가 필요한가:
 * Next 16 의 `prefetch` 는 `boolean | 'auto' | null` 뿐이라 "뷰포트는 끄고 hover 는 살리는"
 * 중간값이 없다. `prefetch={false}` 를 주면 next/link 가 hover·touch 핸들러에서도 곧바로
 * 빠져나간다(`dist/client/app-dir/link.js` 의 `prefetchEnabled = prefetchProp !== false`,
 * onMouseEnter·onTouchStart 시작부의 early return). 그래서 목록에 행이 20개 깔리면
 * 프리페치 20건이 나가는 것은 막았지만, 정작 **누르려고 올린 링크마저 미리 받지 않아**
 * 클릭 후 함수 응답(300~500ms)을 고스란히 기다리게 됐다 (2026-09-13 측정에서 확인).
 *
 * 여기서는 뷰포트 프리페치만 끄고, hover·touch 시점에 router.prefetch() 로 직접 받는다.
 * 화면에 보이기만 한 행은 건드리지 않고, 누를 것 같은 행 하나만 미리 받는다.
 */
export function RowLink({
  href,
  onMouseEnter,
  onTouchStart,
  children,
  ...rest
}: ComponentProps<typeof Link>) {
  const router = useRouter();
  // href 는 문자열이거나 UrlObject 다. router.prefetch 는 문자열만 받는다.
  const target = typeof href === "string" ? href : null;

  return (
    <Link
      {...rest}
      href={href}
      prefetch={false}
      onMouseEnter={(e) => {
        onMouseEnter?.(e);
        if (target) router.prefetch(target);
      }}
      onTouchStart={(e) => {
        onTouchStart?.(e);
        if (target) router.prefetch(target);
      }}
    >
      {children}
    </Link>
  );
}
