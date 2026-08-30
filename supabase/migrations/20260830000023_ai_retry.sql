-- ============================================================
-- Roxlogy — 시스템 감사 수리 (11) AI 인사이트 실패 재시도 경로
--
-- 감사에서 "ai_status='failed' 방치 2건"을 재큐잉했더니 곧바로 다시 실패했고,
-- Edge 로그에서 원인이 드러났다: `gw job failed …: 연결 실패: ConnectError`.
-- 즉 스테일 플래그가 아니라 LLM 게이트웨이(hosub→Mac) 연결 실패였다.
--
-- 문제는 이 일시적 장애가 영구 상태로 굳는다는 것이다 — 디스패처는
-- ai_status='pending' 만 집으므로 'failed' 가 되면 게이트웨이가 돌아와도
-- 영원히 재시도되지 않는다(사용자 화면에서 AI 인사이트가 영구 결손).
--
-- 한도가 있는 재시도를 둔다: 실패 후 30분 지난 건을 최대 5회까지 pending 으로
-- 되돌린다. 게이트웨이가 계속 죽어 있어도 5회에서 멈추므로 무한 루프가 없다.
-- ============================================================

alter table public.sessions
  add column if not exists ai_attempts int not null default 0;
alter table public.race_results
  add column if not exists ai_attempts int not null default 0;

create or replace function public.retry_failed_ai()
returns int
language plpgsql security definer set search_path to 'public' as $$
declare v_n int := 0; v_c int;
begin
  update sessions
  set ai_status = 'pending', ai_attempts = ai_attempts + 1
  where deleted_at is null
    and ai_status = 'failed'
    and ai_attempts < 5
    and updated_at < now() - interval '30 minutes';
  get diagnostics v_c = row_count; v_n := v_n + v_c;

  update race_results
  set ai_status = 'pending', ai_attempts = ai_attempts + 1
  where ai_status = 'failed'
    and ai_attempts < 5
    and created_at < now() - interval '30 minutes';
  get diagnostics v_c = row_count; v_n := v_n + v_c;

  return v_n;
end; $$;

comment on function public.retry_failed_ai() is
  'LLM 게이트웨이 일시 장애로 실패한 AI 인사이트를 최대 5회까지 재큐잉 (pg_cron 30분).';

-- 클라이언트가 호출할 이유가 없다 (크론 전용) — 기본 권한 없음 상태를 유지한다.

select cron.schedule(
  'roxlogy-ai-retry',
  '*/30 * * * *',
  $$select public.retry_failed_ai()$$
);
