-- 워커리스 분석 파이프라인: hosub 워커 제거 → Edge `analysis-dispatch` 가
-- 지표 계산 + llm-gateway 잡 제출/수령을 담당 (pg_cron 1분).
-- ai_jobs = 게이트웨이 잡 추적(제출 중복 방지 클레임 겸용). service role 전용.

create table public.ai_jobs (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('session','weekly','race')),
  user_id      uuid not null,
  ref_id       uuid,            -- session.id / race_results.id
  period_start date,            -- weekly
  job_id       text,            -- 게이트웨이 잡 id (제출 후 기록; null=클레임만)
  created_at   timestamptz not null default now()
);
alter table public.ai_jobs enable row level security; -- 정책 없음 = service role 전용

-- 클레임 유니크 (동시 크론 중복 제출 방지)
create unique index ai_jobs_ref_uq on public.ai_jobs(kind, ref_id) where ref_id is not null;
create unique index ai_jobs_period_uq on public.ai_jobs(kind, user_id, period_start) where period_start is not null;

-- 크론: 1분마다 analysis-dispatch 호출 (push-dispatch 와 동일 패턴 — anon 키는 공개키)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'roxlogy-analysis-dispatch') then
    perform cron.unschedule('roxlogy-analysis-dispatch');
  end if;
end $$;

select cron.schedule(
  'roxlogy-analysis-dispatch', '* * * * *',
  $$
  select net.http_post(
    url := 'https://vuloxbpfhyqkvgmpmkst.supabase.co/functions/v1/analysis-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1bG94YnBmaHlxa3ZnbXBta3N0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyMTc0NzgsImV4cCI6MjA5ODc5MzQ3OH0.WhmfRIZWBS88_Rf-e_p7tMpOLKEX9kKxC67KVrLZGjs'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 50000
  )
  $$
);
