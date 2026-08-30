-- ============================================================
-- Roxlogy — 모임 댓글 (허용 옵션 + 댓글 테이블)
--
-- 모임 등록 시 "댓글 허용"을 선택할 수 있고, 허용된 모임의 상세
-- 페이지에서 크루원이 댓글을 남긴다. members_only 모임은 정회원만.
-- ============================================================

alter table public.crew_events
  add column if not exists comments_allowed boolean not null default true;

create table if not exists public.crew_event_comments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.crew_events(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists crew_event_comments_event_idx
  on public.crew_event_comments(event_id, created_at) where deleted_at is null;

alter table public.crew_event_comments enable row level security;

-- 조회: 그 모임을 볼 수 있는 사람과 동일 (공개 크루/멤버 + members_only 는 정회원)
create policy crew_event_comments_select on public.crew_event_comments
  for select using (
    deleted_at is null and exists (
      select 1 from crew_events e join crews c on c.id = e.crew_id
      where e.id = event_id
        and (c.is_public or is_crew_member(e.crew_id) or is_admin())
        and (not e.members_only or is_crew_full_member(e.crew_id) or is_admin())
    )
  );

-- 작성: 크루원 + 댓글 허용 모임만 (members_only 존중, 취소된 모임 제외)
create policy crew_event_comments_insert on public.crew_event_comments
  for insert with check (
    author_id = auth.uid() and exists (
      select 1 from crew_events e
      where e.id = event_id
        and e.cancelled_at is null
        and e.comments_allowed
        and is_crew_member(e.crew_id)
        and (not e.members_only or is_crew_full_member(e.crew_id))
    )
  );

-- 삭제: 본인·운영진·관리자
create policy crew_event_comments_delete on public.crew_event_comments
  for delete using (
    author_id = auth.uid() or is_admin() or exists (
      select 1 from crew_events e
      where e.id = event_id and is_crew_staff(e.crew_id)
    )
  );

-- crew_event_detail: comments_allowed + comments 반환 (반환형 변경 → 재생성)
drop function if exists public.crew_event_detail(uuid);
create function public.crew_event_detail(p_event uuid)
returns table(
  id uuid, slug text, title text, description text, kind text,
  starts_at timestamptz, ends_at timestamptz, location text, capacity integer,
  going_names text[], maybe_names text[], declined_count bigint,
  my_status text, is_staff boolean,
  comments_allowed boolean, comments jsonb
)
language sql stable security definer set search_path to 'public' as $$
  select e.id, c.slug, e.title, e.description, e.kind,
         e.starts_at, e.ends_at, e.location, e.capacity,
         coalesce((select array_agg(coalesce(pr.display_name, 'Athlete') order by r.created_at)
            from crew_event_rsvps r join profiles pr on pr.id = r.user_id
            where r.event_id = e.id and r.status = 'going'), '{}'),
         coalesce((select array_agg(coalesce(pr.display_name, 'Athlete') order by r.created_at)
            from crew_event_rsvps r join profiles pr on pr.id = r.user_id
            where r.event_id = e.id and r.status = 'maybe'), '{}'),
         (select count(*) from crew_event_rsvps r
            where r.event_id = e.id and r.status = 'declined'),
         (select r.status from crew_event_rsvps r
            where r.event_id = e.id and r.user_id = auth.uid()),
         is_crew_staff(e.crew_id),
         e.comments_allowed,
         coalesce((select jsonb_agg(jsonb_build_object(
              'id', cm.id, 'author_id', cm.author_id,
              'author_name', coalesce(pr2.display_name, 'Athlete'),
              'body', cm.body, 'created_at', cm.created_at)
              order by cm.created_at)
            from crew_event_comments cm
            join profiles pr2 on pr2.id = cm.author_id
            where cm.event_id = e.id and cm.deleted_at is null), '[]'::jsonb)
  from crew_events e
  join crews c on c.id = e.crew_id
  where e.id = p_event
    and e.cancelled_at is null
    and (c.is_public or is_crew_member(c.id))
    and (not e.members_only or is_crew_full_member(e.crew_id));
$$;
grant execute on function public.crew_event_detail(uuid) to anon, authenticated;
