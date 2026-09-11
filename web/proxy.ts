import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { optedOut, sessionOnly } from "@/lib/supabase/keep";
import { safeNext } from "@/lib/site-url";

/**
 * 로그인 검사의 유일한 예외: `/programs/<uuid>/calendar.ics`.
 *
 * 구글·애플 캘린더 서버는 쿠키 없이 `?token=` 만 들고 주기적으로 fetch 한다.
 * 그런데 `/programs` 가 보호 접두이고 matcher 도 `.ics` 를 거르지 않아, 이 요청이
 * route 의 토큰 검증에 닿기도 전에 `/login` 으로 307 되어 캘린더가 ICS 대신
 * 로그인 HTML 을 받았다 (감사 A04, 2026-09-11). 그렇다고 `/programs` 전체를
 * 열면 프로그램 화면이 통째로 노출되므로, 정규식으로 **정확히 이 경로만** 뺀다.
 * 접근 통제는 route 가 맡는다: 토큰이 있으면 program_calendar() RPC 가 검증하고,
 * 토큰이 없으면 route 가 세션을 확인해 401 을 돌려준다.
 *
 * pathname 은 WHATWG URL 파서가 `..`·`%2e%2e` 세그먼트를 이미 정규화한 값이라
 * `/programs/<uuid>/calendar.ics/../` 같은 우회는 다른 경로로 접혀 보호 목록에
 * 걸린다. 정규식은 앵커(`^`·`$`)를 두어 접미·접두 변형도 통과시키지 않는다.
 */
const ICS_SUBSCRIBE_RE =
  /^\/programs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/calendar\.ics$/i;

/**
 * 로그인이 필요한 경로 = app/(app) 아래 전부.
 *
 * 목록이 (app) 폴더와 어긋나면 안 된다: 여기 없는 경로는 (app)/layout.tsx 의
 * redirect("/login") 로 떨어지는데, 레이아웃은 서버에서 pathname 을 알 수 없어
 * next 를 붙이지 못한다 — 공유 링크를 받고 로그인한 사람이 원래 보려던 화면
 * 대신 대시보드로 떨어졌다 (2026-09-10, 카톡 인앱 브라우저에서 확인).
 * (app) 에 폴더를 추가하면 여기에도 추가할 것.
 */
const PROTECTED_PREFIXES = [
  "/admin",
  "/dashboard",
  "/exercises",
  "/feed",
  "/goals",
  "/insights",
  "/leaderboard",
  "/members",
  "/notifications",
  "/pft",
  "/programs",
  "/races",
  "/runs",
  "/schedule",
  "/search",
  "/sessions",
  "/settings",
  "/u",
  "/workouts",
];

/**
 * 이 pathname 에 로그인 세션이 있어야 하는가.
 *
 * NextRequest 없이 순수 문자열만 받는 이유: 판정 로직을 node 스크립트로 바로
 * 검증하기 위해서다(비로그인 ICS 통과 / 비로그인 `/programs` 차단 / 경로 변형
 * 우회 없음). proxy() 는 이 함수 하나로 보호 여부를 정한다.
 */
export function requiresLogin(pathname: string): boolean {
  if (ICS_SUBSCRIBE_RE.test(pathname)) return false;
  return PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          const off = optedOut(request.cookies.getAll());
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(
              name,
              value,
              off ? sessionOnly(options) : options,
            ),
          );
        },
      },
    },
  );

  // getClaims()는 비대칭 서명키가 켜져 있으면 JWT 를 로컬 검증하고(네트워크 0회),
  // 아니면 getUser() 와 동일하게 Auth 서버로 폴백한다 — 만료 세션 리프레시도 그대로.
  // getSession() 은 검증 없이 쿠키를 믿으므로 사용 금지.
  const { data: claims } = await supabase.auth.getClaims();
  const user = claims?.claims ? { id: claims.claims.sub } : null;

  const { pathname } = request.nextUrl;

  if (!user && requiresLogin(pathname)) {
    const url = request.nextUrl.clone();
    // 쿼리까지 들고 가야 한다 — /schedule/race/x?from=... 처럼 쿼리가 화면을
    // 결정하는 경로가 있다
    const target = pathname + request.nextUrl.search;
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", target);
    return NextResponse.redirect(url);
  }

  if (
    user &&
    (pathname === "/" || pathname === "/login" || pathname === "/signup")
  ) {
    // 이미 로그인한 사람이 공유 링크발 /login?next=... 로 와도 목적지를 잃지 않는다.
    // next 에 쿼리가 붙어 있을 수 있으므로 URL 로 파싱해 경로·쿼리를 함께 옮긴다.
    const next = safeNext(request.nextUrl.searchParams.get("next"));
    const url = request.nextUrl.clone();
    if (next) {
      const target = new URL(next, request.url);
      url.pathname = target.pathname;
      url.search = target.search;
    } else {
      url.pathname = "/dashboard";
      url.search = "";
    }
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

// 인증 판정이 필요한 문서 요청에만 실행한다. api·auth 콜백 라우트는 자체적으로
// 세션을 검증하므로 여기서 한 번 더 왕복하지 않는다(요청당 왕복 1회 절감).
export const config = {
  matcher: [
    "/((?!api|auth|_next/static|_next/image|favicon.ico|manifest.webmanifest|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|json|txt)$).*)",
  ],
};
