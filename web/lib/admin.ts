import { createClient } from "@/lib/supabase/server";

/** 현재 사용자가 관리자인지 서버에서 확인. is_admin RLS/함수와 동일 판정. */
export async function getAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, isAdmin: false, supabase };
  const { data } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  return { user, isAdmin: data?.is_admin === true, supabase };
}
