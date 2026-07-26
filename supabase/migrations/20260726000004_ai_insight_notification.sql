-- AI 인사이트(세션 코칭·레이스 리포트·주간 리포트) 등록 완료 푸시 알림 종류.
-- 발송은 analysis-dispatch 가 인사이트 저장 직후 enqueue_notification 으로 인큐.

insert into public.notification_types(key, description, default_enabled) values
  ('ai_insight', 'AI 코칭 코멘트 등록', true)
on conflict (key) do nothing;
