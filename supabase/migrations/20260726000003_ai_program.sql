-- AI 프로그램 생성: 코칭 인사이트 기반 7일 WOD 프로그램을 32b가 작성해
-- programs/일자/워크아웃/아이템으로 실체화. 요청 큐는 ai_jobs(kind='program') 재사용.

-- ai_jobs.kind 에 'program' 허용
alter table public.ai_jobs drop constraint if exists ai_jobs_kind_check;
alter table public.ai_jobs
  add constraint ai_jobs_kind_check check (kind in ('session','weekly','race','program'));

-- 사용자당 동시 1개 요청 (job 진행 중 중복 요청 방지)
create unique index if not exists ai_jobs_program_uq
  on public.ai_jobs(kind, user_id) where kind = 'program';

-- 완료 알림 종류 (푸시 파이프라인 재사용 — notification_types 행 1개가 곧 확장)
insert into public.notification_types(key, description, default_enabled) values
  ('ai_program', 'AI 훈련 프로그램 생성 완료', true)
on conflict (key) do nothing;

-- Edge(analysis-dispatch, service role)가 옵트아웃 존중 인큐 함수를 호출할 수 있게
grant execute on function public.enqueue_notification(uuid, text, text, text, text) to service_role;
