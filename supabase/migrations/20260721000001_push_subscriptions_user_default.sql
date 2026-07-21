-- push_subscriptions.user_id 에 auth.uid() 기본값 추가.
-- 네이티브(안드로이드 FCM) 클라이언트가 user_id 를 계산해 보내지 않아도 되도록 —
-- RLS insert 체크(user_id = auth.uid())와 정합. 웹 클라이언트(명시적 user_id)도 그대로 동작.
alter table public.push_subscriptions
  alter column user_id set default auth.uid();
