-- ============================================================
-- HYROX Training App — 003 멱등성·LWW 보강 + session_metrics
-- 배경:
--  • 세그먼트/raw는 서버 생성 UUID뿐이라 재전송 시 중복 삽입됨
--    → 업서트 충돌 키(unique) 추가. 클라이언트는 세그먼트 id도
--      직접 생성해 보내는 것을 원칙으로 한다(세션과 동일).
--  • updated_at은 트리거가 now()로 덮어써 "서버 도착 순"이 됨
--    → LWW 판정용 client_updated_at(클라이언트 이벤트 시각) 분리.
--  • 기획서 §3.2의 session_metrics(세션 단위 파생 지표)가 스키마에
--    누락되어 있었음 → 신설.
--  • 삭제된 세션이 오프라인 기기 재동기화로 부활하는 것을 막기 위해
--    soft delete(deleted_at) 도입.
-- ============================================================

-- ------------------------------------------------------------
-- 1. 멱등 업서트 키 (재전송 안전)
-- ------------------------------------------------------------
-- 세그먼트: 같은 세션 내 seq는 유일 → on conflict (session_id, seq)
alter table public.session_segments
  add constraint uq_segments_session_seq unique (session_id, seq);

-- 기존 idx_segments_session(session_id, seq)는 위 유니크 인덱스와 중복 → 제거
drop index if exists public.idx_segments_session;

-- erg raw: 세그먼트당 raw 한 덩어리 원칙 → on conflict (segment_id)
alter table public.erg_samples
  add constraint uq_ergsamples_segment unique (segment_id);

-- 기존 idx_ergsamples_segment(segment_id)도 유니크 인덱스와 중복 → 제거
drop index if exists public.idx_ergsamples_segment;

-- ------------------------------------------------------------
-- 2. LWW 충돌 판정용 클라이언트 이벤트 시각
--    (updated_at = 서버 수신 시각, client_updated_at = 기기에서
--     마지막으로 수정한 시각. LWW 비교는 client_updated_at 기준)
-- ------------------------------------------------------------
alter table public.sessions
  add column client_updated_at timestamptz not null default now();

-- 업서트 계약(Edge Function/클라이언트 공통):
--   insert into sessions ... on conflict (id) do update set ...
--   where excluded.client_updated_at > sessions.client_updated_at;
-- → 오프라인 기기의 옛 데이터가 늦게 도착해도 최신 데이터를 덮지 않음.

-- ------------------------------------------------------------
-- 3. soft delete (삭제 세션의 오프라인 부활 방지)
--    삭제 = deleted_at 기록(tombstone). 조회는 deleted_at is null 필터.
--    재동기화로 도착한 업서트도 tombstone 행에 병합되므로 부활하지 않음.
-- ------------------------------------------------------------
alter table public.sessions
  add column deleted_at timestamptz;

-- 히스토리 조회용 인덱스를 활성 세션 기준 partial index로 교체
drop index if exists public.idx_sessions_user;
create index idx_sessions_user
  on public.sessions(user_id, started_at desc)
  where deleted_at is null;

-- ------------------------------------------------------------
-- 4. 세션 단위 파생 지표 (기획서 §3.2 — S6/S15 페이싱 일관성)
--    write는 hosub 워커(service role, RLS 우회), 사용자는 읽기만.
-- ------------------------------------------------------------
create table public.session_metrics (
  session_id           uuid primary key references public.sessions(id) on delete cascade,
  run_lap_deviation_ms bigint,          -- 8개 런 랩 편차 (페이싱 일관성)
  roxzone_total_ms     bigint,          -- ROXZONE 합산 시간
  pacing_grade         text,            -- 예: 'very_consistent' / 'consistent' / ...
  computed_at          timestamptz not null default now()
);

alter table public.session_metrics enable row level security;

create policy "session_metrics_select_own" on public.session_metrics
  for select using (
    exists (
      select 1 from public.sessions s
      where s.id = session_metrics.session_id and s.user_id = auth.uid()
    )
  );
