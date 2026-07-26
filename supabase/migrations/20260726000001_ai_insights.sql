-- AI 인사이트 (Phase 2): hosub 워커가 Mac LLM(Ollama)으로 생성한 코칭 코멘트 저장.
-- 종류: session(세션 코칭) / weekly(주간 훈련 리포트) / race(레이스 분석).
-- 쓰기는 워커(service role) 전용 — 사용자 정책은 select own 만.

create table public.ai_insights (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  kind         text not null check (kind in ('session','weekly','race')),
  ref_id       uuid,           -- session.id / race_results.id (weekly 는 null)
  period_start date,           -- weekly 기간 시작(월요일, 사용자 타임존 기준)
  content      text not null,  -- 한국어 코멘트 (담백·데이터 기반 — 브랜드 톤)
  model        text,           -- 생성 모델 (예: qwen2.5:32b)
  created_at   timestamptz not null default now()
);

alter table public.ai_insights enable row level security;
create policy "ai_insights_select_own" on public.ai_insights
  for select using (user_id = auth.uid());

-- 종류별 1개 보장 (워커는 delete+insert 로 재생성)
create unique index ai_insights_ref_uq
  on public.ai_insights(user_id, kind, ref_id) where ref_id is not null;
create unique index ai_insights_period_uq
  on public.ai_insights(user_id, kind, period_start) where period_start is not null;
create index ai_insights_user_idx on public.ai_insights(user_id, created_at desc);

-- 세션/레이스 AI 큐 상태 — 지표(analysis_status)와 분리해 Mac(LLM)이 꺼져 있어도
-- 지표 계산은 막히지 않고, LLM 작업만 pending 으로 남아 재시도된다.
alter table public.sessions
  add column ai_status text not null default 'pending'
    check (ai_status in ('pending','done','failed','skip'));
create index idx_sessions_ai on public.sessions(ai_status) where ai_status = 'pending';

alter table public.race_results
  add column ai_status text not null default 'pending'
    check (ai_status in ('pending','done','failed','skip'));
create index idx_races_ai on public.race_results(ai_status) where ai_status = 'pending';
