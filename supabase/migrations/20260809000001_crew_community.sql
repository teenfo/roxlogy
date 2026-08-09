-- 크루(커뮤니티) 레이어 — INBRXX 같은 오프라인 훈련 크루를 Roxlogy 안에서 운영한다.
--
-- 기존 소셜 레이어(follows·community_feed)는 전역 1:1 관계만 다뤘다. 크루는 그와 별개로
-- "어느 짐에서 함께 훈련하는 무리"를 1급 객체로 세우고 게시판·일정·크루 리더보드를 묶는다.
--
-- 읽기는 공개 크루라면 비로그인도 가능해야 하므로(랜딩 겸용) SECURITY DEFINER RPC 로 노출하고,
-- 쓰기는 RLS 로 멤버십을 강제한다. crew_members 를 참조하는 정책이 다시 crew_members 의 RLS 를
-- 타면 재귀하므로, 멤버십 판정은 is_crew_member()/is_crew_staff() 헬퍼로 우회한다.

-- 1. 크루 · 멤버십 -----------------------------------------------------------

create table if not exists public.crews (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  tagline text,
  description text,
  logo_url text,
  cover_url text,
  location text,
  home_gym text,
  links jsonb not null default '{}'::jsonb,
  is_public boolean not null default true,
  join_policy text not null default 'open'
    check (join_policy in ('open','approval','invite')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crew_members (
  crew_id uuid not null references public.crews(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','coach','member')),
  status text not null default 'active' check (status in ('pending','active','blocked')),
  joined_at timestamptz not null default now(),
  primary key (crew_id, user_id)
);

create index if not exists crew_members_user_idx on public.crew_members(user_id) where status = 'active';
create index if not exists crew_members_crew_idx on public.crew_members(crew_id) where status = 'active';

alter table public.crews enable row level security;
alter table public.crew_members enable row level security;

create or replace function public.is_crew_member(p_crew uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from crew_members m
    where m.crew_id = p_crew and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

create or replace function public.is_crew_staff(p_crew uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from crew_members m
    where m.crew_id = p_crew and m.user_id = auth.uid()
      and m.status = 'active' and m.role in ('owner','coach')
  );
$$;

create or replace function public.crew_id_by_slug(p_slug text)
returns uuid language sql stable security definer set search_path to 'public' as $$
  select id from crews where slug = p_slug;
$$;

create policy crews_select_public on public.crews
  for select using (is_public = true or is_crew_member(id) or is_admin());
create policy crews_insert_auth on public.crews
  for insert with check (auth.uid() is not null and created_by = auth.uid());
create policy crews_update_staff on public.crews
  for update using (is_crew_staff(id) or is_admin())
  with check (is_crew_staff(id) or is_admin());
create policy crews_delete_admin on public.crews
  for delete using (is_admin());

create policy crew_members_select on public.crew_members
  for select using (user_id = auth.uid() or is_crew_member(crew_id) or is_admin());
create policy crew_members_join_self on public.crew_members
  for insert with check (user_id = auth.uid());
create policy crew_members_update_staff on public.crew_members
  for update using (is_crew_staff(crew_id) or is_admin())
  with check (is_crew_staff(crew_id) or is_admin());
create policy crew_members_leave_self on public.crew_members
  for delete using (user_id = auth.uid() or is_crew_staff(crew_id) or is_admin());

create trigger crews_set_updated_at before update on public.crews
  for each row execute function public.set_updated_at();

-- 2. 게시판 ------------------------------------------------------------------

create table if not exists public.crew_posts (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crews(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  category text not null default 'free'
    check (category in ('notice','free','wod','review','recruit','question')),
  title text not null,
  body text,
  image_urls text[] default '{}',
  session_id uuid references public.sessions(id) on delete set null,
  pinned boolean not null default false,
  comment_count integer not null default 0,
  like_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists crew_posts_crew_created_idx
  on public.crew_posts(crew_id, created_at desc) where deleted_at is null;

create table if not exists public.crew_post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.crew_posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists crew_post_comments_post_idx
  on public.crew_post_comments(post_id, created_at) where deleted_at is null;

create table if not exists public.crew_post_likes (
  post_id uuid not null references public.crew_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.crew_posts enable row level security;
alter table public.crew_post_comments enable row level security;
alter table public.crew_post_likes enable row level security;

create policy crew_posts_select on public.crew_posts
  for select using (
    deleted_at is null and (
      exists (select 1 from crews c where c.id = crew_id and c.is_public)
      or is_crew_member(crew_id) or is_admin()
    )
  );
create policy crew_posts_insert_member on public.crew_posts
  for insert with check (author_id = auth.uid() and is_crew_member(crew_id));
create policy crew_posts_update_own on public.crew_posts
  for update using (author_id = auth.uid() or is_crew_staff(crew_id) or is_admin())
  with check (author_id = auth.uid() or is_crew_staff(crew_id) or is_admin());
create policy crew_posts_delete_own on public.crew_posts
  for delete using (author_id = auth.uid() or is_crew_staff(crew_id) or is_admin());

create policy crew_post_comments_select on public.crew_post_comments
  for select using (
    deleted_at is null and exists (
      select 1 from crew_posts p join crews c on c.id = p.crew_id
      where p.id = post_id and (c.is_public or is_crew_member(p.crew_id) or is_admin())
    )
  );
create policy crew_post_comments_insert on public.crew_post_comments
  for insert with check (
    author_id = auth.uid() and exists (
      select 1 from crew_posts p where p.id = post_id and is_crew_member(p.crew_id)
    )
  );
create policy crew_post_comments_update_own on public.crew_post_comments
  for update using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy crew_post_comments_delete_own on public.crew_post_comments
  for delete using (
    author_id = auth.uid() or is_admin() or exists (
      select 1 from crew_posts p where p.id = post_id and is_crew_staff(p.crew_id)
    )
  );

create policy crew_post_likes_select on public.crew_post_likes
  for select using (true);
create policy crew_post_likes_insert on public.crew_post_likes
  for insert with check (
    user_id = auth.uid() and exists (
      select 1 from crew_posts p where p.id = post_id and is_crew_member(p.crew_id)
    )
  );
create policy crew_post_likes_delete_own on public.crew_post_likes
  for delete using (user_id = auth.uid());

-- 댓글·좋아요 카운터는 목록 조회에서 매번 세지 않도록 트리거로 유지한다.
create or replace function public.bump_post_counters()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_table_name = 'crew_post_comments' then
    if tg_op = 'INSERT' then
      update crew_posts set comment_count = comment_count + 1 where id = new.post_id;
    elsif tg_op = 'DELETE' then
      update crew_posts set comment_count = greatest(comment_count - 1, 0) where id = old.post_id;
    end if;
  elsif tg_table_name = 'crew_post_likes' then
    if tg_op = 'INSERT' then
      update crew_posts set like_count = like_count + 1 where id = new.post_id;
    elsif tg_op = 'DELETE' then
      update crew_posts set like_count = greatest(like_count - 1, 0) where id = old.post_id;
    end if;
  end if;
  return null;
end;
$$;

create trigger crew_post_comments_count after insert or delete on public.crew_post_comments
  for each row execute function public.bump_post_counters();
create trigger crew_post_likes_count after insert or delete on public.crew_post_likes
  for each row execute function public.bump_post_counters();
create trigger crew_posts_set_updated_at before update on public.crew_posts
  for each row execute function public.set_updated_at();

-- 3. 일정 · 참석 -------------------------------------------------------------

create table if not exists public.crew_events (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crews(id) on delete cascade,
  title text not null,
  description text,
  kind text not null default 'wod'
    check (kind in ('wod','race_sim','run','strength','social','race')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  capacity integer,
  coach_id uuid references public.profiles(id) on delete set null,
  template_id uuid references public.workout_templates(id) on delete set null,
  race_event_id uuid references public.race_events(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz
);

create index if not exists crew_events_crew_start_idx
  on public.crew_events(crew_id, starts_at desc) where cancelled_at is null;

create table if not exists public.crew_event_rsvps (
  event_id uuid not null references public.crew_events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'going' check (status in ('going','maybe','declined')),
  checked_in_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

alter table public.crew_events enable row level security;
alter table public.crew_event_rsvps enable row level security;

create policy crew_events_select on public.crew_events
  for select using (
    exists (select 1 from crews c where c.id = crew_id and c.is_public)
    or is_crew_member(crew_id) or is_admin()
  );
create policy crew_events_write_staff on public.crew_events
  for all using (is_crew_staff(crew_id) or is_admin())
  with check (is_crew_staff(crew_id) or is_admin());

create policy crew_event_rsvps_select on public.crew_event_rsvps
  for select using (
    user_id = auth.uid() or exists (
      select 1 from crew_events e where e.id = event_id and is_crew_member(e.crew_id)
    ) or is_admin()
  );
create policy crew_event_rsvps_upsert_self on public.crew_event_rsvps
  for insert with check (
    user_id = auth.uid() and exists (
      select 1 from crew_events e where e.id = event_id and is_crew_member(e.crew_id)
    )
  );
create policy crew_event_rsvps_update on public.crew_event_rsvps
  for update using (
    user_id = auth.uid() or exists (
      select 1 from crew_events e where e.id = event_id and is_crew_staff(e.crew_id)
    )
  ) with check (
    user_id = auth.uid() or exists (
      select 1 from crew_events e where e.id = event_id and is_crew_staff(e.crew_id)
    )
  );
create policy crew_event_rsvps_delete_self on public.crew_event_rsvps
  for delete using (
    user_id = auth.uid() or exists (
      select 1 from crew_events e where e.id = event_id and is_crew_staff(e.crew_id)
    )
  );

create trigger crew_events_set_updated_at before update on public.crew_events
  for each row execute function public.set_updated_at();
