import { createBrowserClient } from "@supabase/ssr";
import { KEEP_COOKIE } from "@/lib/supabase/keep";

/** document.cookie → {name,value}[] */
function readAll() {
  if (typeof document === "undefined") return [];
  return document.cookie
    .split("; ")
    .filter(Boolean)
    .map((c) => {
      const i = c.indexOf("=");
      return i < 0
        ? { name: decodeURIComponent(c), value: "" }
        : {
            name: decodeURIComponent(c.slice(0, i)),
            value: decodeURIComponent(c.slice(i + 1)),
          };
    });
}

function keptSignedIn() {
  return !readAll().some((c) => c.name === KEEP_COOKIE && c.value === "0");
}

export function createClient() {
  // 기본(유지 켬)은 라이브러리 기본 동작 그대로 — 400일 쿠키.
  if (keptSignedIn()) {
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  // 유지를 끈 경우에만 어댑터를 끼워 만료를 빼고 굽는다(=세션 쿠키).
  // 라이브러리가 setCookieOptions 에서 maxAge 를 강제하므로 옵션으로는 못 끈다.
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: readAll,
        setAll(list) {
          for (const { name, value, options } of list) {
            let c = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
            c += `; Path=${options?.path ?? "/"}`;
            c += `; SameSite=${options?.sameSite ?? "Lax"}`;
            if (location.protocol === "https:") c += "; Secure";
            // 삭제 지시는 그대로 통과시킨다 — 로그아웃이 막히면 안 된다
            if (options?.maxAge === 0) c += "; Max-Age=0";
            document.cookie = c;
          }
        },
      },
    },
  );
}
