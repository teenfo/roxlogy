-- ============================================================
-- 008 — 커뮤니티 (S10): 세션 공유 + 팔로우 피드
-- 프라이버시: 세션은 기본 비공개. 소유자가 명시적으로 공유(shared=true)한
-- 세션만 타 사용자가 조회할 수 있다(스플릿·페이싱·곡선까지, erg 원본 제외).
-- follows는 본인 것만 관리. 피드의 작성자 표시 이름은 profiles가 본인만
-- 읽히므로 security-definer 함수로 공유 세션 작성자에 한해 노출한다.
-- ============================================================

-- 1. 세션 공유 플래그 + 공유 읽기 RLS (permissive: own OR shared)
alter table public.sessions
  add column shared boolean not null default false;

create policy "sessions_select_shared" on public.sessions
  for select using (shared = true and deleted_at is null);

create policy "segments_select_shared" on public.session_segments
  for select using (
    exists (
      select 1 from public.sessions s
      where s.id = session_segments.session_id
        and s.shared = true and s.deleted_at is null
    )
  );

create policy "session_metrics_select_shared" on public.session_metrics
  for select using (
    exists (
      select 1 from public.sessions s
      where s.id = session_metrics.session_id and s.shared = true
    )
  );

create policy "segment_metrics_select_shared" on public.segment_metrics
  for select using (
    exists (
      select 1 from public.session_segments g
      join public.sessions s on s.id = g.session_id
      where g.id = segment_metrics.segment_id and s.shared = true
    )
  );

-- 2. 팔로우 (본인 것만 관리)
create table public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followee_id uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

alter table public.follows enable row level security;

create policy "follows_select_own" on public.follows
  for select using (follower_id = auth.uid());
create policy "follows_insert_own" on public.follows
  for insert with check (follower_id = auth.uid());
create policy "follows_delete_own" on public.follows
  for delete using (follower_id = auth.uid());

-- 3. 커뮤니티 피드: 공유 세션 목록 + 작성자 이름.
--    p_following=true 면 내가 팔로우한 사용자의 공유 세션만.
create or replace function public.community_feed(
  p_following boolean default false,
  p_limit int default 50
)
returns table(
  session_id uuid,
  author_id uuid,
  author_name text,
  started_at timestamptz,
  total_time_ms bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select s.id, s.user_id,
         coalesce(p.display_name, 'Athlete') as author_name,
         s.started_at, s.total_time_ms
  from sessions s
  join profiles p on p.id = s.user_id
  where s.shared = true and s.deleted_at is null
    and (
      not p_following
      or exists (
        select 1 from follows f
        where f.follower_id = auth.uid() and f.followee_id = s.user_id
      )
    )
  order by s.started_at desc
  limit least(p_limit, 100);
$$;

revoke all on function public.community_feed(boolean, int) from public;
grant execute on function public.community_feed(boolean, int) to authenticated;
