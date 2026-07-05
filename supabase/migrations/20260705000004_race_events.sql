-- ============================================================
-- HYROX Training App — 004 공식 대회 일정 (race_events)
-- 기획서 §3.2의 2단계 테이블을 일정 검색 기능을 위해 조기 도입.
-- 저장하는 것은 공개된 사실 정보(대회명·도시·날짜)만 — 외부
-- 콘텐츠 스크래핑 아님 (S12 원칙). 결과 데이터는 포함하지 않는다.
-- ============================================================

create table public.race_events (
  id           uuid primary key default uuid_generate_v4(),
  name         text not null,                 -- 예: 'HYROX Seoul'
  city         text not null,
  country      text not null,                 -- ISO 이름 (한국어 표기)
  region       text check (region in
                 ('asia','europe','north_america','south_america','africa','oceania')),
  venue        text,
  start_date   date,                          -- null이면 일정 미확정(date_note 참조)
  end_date     date,
  date_note    text,                          -- 월 단위 공지 등 ('2026년 8월 예정')
  season       text,                          -- 'S8 2025/26' / 'S9 2026/27'
  official_url text,
  created_at   timestamptz not null default now()
);

create index idx_race_events_date on public.race_events(start_date);
create index idx_race_events_city on public.race_events(city);

-- 공개 사실 정보 — 비로그인 포함 전체 읽기 허용 (쓰기는 service role 전용)
alter table public.race_events enable row level security;
create policy "race_events_select_all" on public.race_events
  for select using (true);
