import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { optedOut, sessionOnly } from "@/lib/supabase/keep";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            // 유지를 끈 사용자는 서버가 세션을 갱신할 때도 만료를 붙이면 안 된다 —
            // 안 그러면 다음 리프레시에서 400일 쿠키로 슬그머니 되살아난다.
            const off = optedOut(cookieStore.getAll());
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, off ? sessionOnly(options) : options),
            );
          } catch {
            // 서버 컴포넌트에서 호출되면 쿠키를 쓸 수 없음 —
            // 미들웨어가 세션을 리프레시하므로 무시해도 안전.
          }
        },
      },
    },
  );
}
