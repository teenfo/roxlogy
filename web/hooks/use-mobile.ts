import * as React from "react";

/**
 * shadcn 의 useIsMobile — 시안 hooks/use-mobile.ts 와 같은 기준(768px 미만).
 * 효과 안에서 setState 를 부르는 원본 대신 useSyncExternalStore 로 구독한다
 * (react-hooks/set-state-in-effect 규칙). 서버 스냅샷은 false(데스크톱).
 */
const MOBILE_BREAKPOINT = 768;
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
