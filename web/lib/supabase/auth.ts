import { cache } from "react";
import { createClient } from "./server";

/**
 * 요청당 1회만 Auth 서버를 호출한다.
 *
 * 레이아웃과 페이지가 각각 `supabase.auth.getUser()` 를 부르면 같은 요청에서
 * Supabase Auth 로 나가는 왕복이 그 수만큼 늘어난다(도쿄 리전 기준 1회당 수십 ms).
 * React `cache()` 는 한 번의 서버 렌더 안에서 결과를 공유하므로 왕복이 1회로 줄고,
 * 요청 사이에는 공유되지 않아 세션 격리도 그대로 유지된다.
 */
export const getCachedUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/** 로그인 사용자의 프로필 — 레이아웃(is_admin·disabled)과 페이지가 공유. */
export const getCachedProfile = cache(async () => {
  const user = await getCachedUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  return data;
});
