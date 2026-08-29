-- ============================================================
-- Roxlogy — 정회원 전용 콘텐츠
--
-- 1) 게시글: members_only 체크 — 일반회원(associate)·비멤버에게 숨김
-- 2) 회계: 정회원 전용으로 강화 (일반회원 열람 불가)
-- 3) 일정(모임): members_only 체크 — 정회원에게만 표시
-- "정회원" = role <> 'associate' (리더·부리더 자동 포함, tiers 마이그레이션 규칙).
-- 조회가 SECURITY DEFINER RPC 를 타므로 RLS 와 RPC 양쪽에 필터를 건다.
-- ============================================================

create or replace function public.is_crew_full_member(p_crew uuid)
returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from crew_members m
    where m.crew_id = p_crew and m.user_id = auth.uid()
      and m.status = 'active' and m.role <> 'associate');
$$;

-- ---------- 1) 게시글
alter table public.crew_posts
  add column if not exists members_only boolean not null default false;

drop policy if exists crew_posts_select on public.crew_posts;
create policy crew_posts_select on public.crew_posts
  for select using (
    deleted_at is null and (
      exists (select 1 from crews c where c.id = crew_id and c.is_public)
      or is_crew_member(crew_id) or is_admin()
    )
    and (not members_only or author_id = auth.uid()
         or is_crew_full_member(crew_id) or is_admin())
  );

drop function if exists public.crew_board(text, text, integer, integer);
create function public.crew_board(
  p_slug text, p_category text default null, p_limit integer default 20, p_offset integer default 0
)
returns table(
  id uuid, category text, title text, body text, image_urls text[],
  author_id uuid, author_name text, author_division text,
  pinned boolean, comment_count integer, like_count integer,
  liked_by_me boolean, created_at timestamptz, members_only boolean
)
language sql stable security definer set search_path to 'public' as $$
  select p.id, p.category, p.title, p.body, p.image_urls,
         p.author_id,
         coalesce(pr.display_name, 'Athlete') as author_name,
         pr.division as author_division,
         p.pinned, p.comment_count, p.like_count,
         exists (select 1 from crew_post_likes l
                 where l.post_id = p.id and l.user_id = auth.uid()) as liked_by_me,
         p.created_at, p.members_only
  from crew_posts p
  join crews c on c.id = p.crew_id
  join profiles pr on pr.id = p.author_id
  where c.slug = p_slug
    and p.deleted_at is null
    and (c.is_public or is_crew_member(c.id))
    and (not p.members_only or p.author_id = auth.uid()
         or is_crew_full_member(c.id) or is_admin())
    and (p_category is null or p.category = p_category)
  order by p.pinned desc, p.created_at desc
  limit least(p_limit, 50) offset greatest(p_offset, 0);
$$;
grant execute on function public.crew_board(text, text, integer, integer) to anon, authenticated;

drop function if exists public.crew_post_detail(uuid);
create function public.crew_post_detail(p_post uuid)
returns table(
  id uuid, category text, title text, body text, image_urls text[],
  author_id uuid, author_name text, pinned boolean,
  comment_count integer, like_count integer, liked_by_me boolean,
  created_at timestamptz, comments jsonb, members_only boolean
)
language sql stable security definer set search_path to 'public' as $$
  select p.id, p.category, p.title, p.body, p.image_urls,
         p.author_id, coalesce(pr.display_name, 'Athlete'), p.pinned,
         p.comment_count, p.like_count,
         exists (select 1 from crew_post_likes l where l.post_id = p.id and l.user_id = auth.uid()),
         p.created_at,
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'id', cm.id, 'author_id', cm.author_id,
             'author_name', coalesce(cpr.display_name, 'Athlete'),
             'body', cm.body, 'created_at', cm.created_at
           ) order by cm.created_at)
           from crew_post_comments cm
           join profiles cpr on cpr.id = cm.author_id
           where cm.post_id = p.id and cm.deleted_at is null
         ), '[]'::jsonb),
         p.members_only
  from crew_posts p
  join crews c on c.id = p.crew_id
  join profiles pr on pr.id = p.author_id
  where p.id = p_post and p.deleted_at is null
    and (c.is_public or is_crew_member(c.id))
    and (not p.members_only or p.author_id = auth.uid()
         or is_crew_full_member(c.id) or is_admin());
$$;
grant execute on function public.crew_post_detail(uuid) to anon, authenticated;

-- ---------- 2) 회계 — 정회원 전용
drop policy if exists crew_ledger_select on public.crew_ledger;
create policy crew_ledger_select on public.crew_ledger
  for select using (is_crew_full_member(crew_id) or is_admin());

-- ---------- 3) 일정(모임)
alter table public.crew_events
  add column if not exists members_only boolean not null default false;

drop policy if exists crew_events_select on public.crew_events;
create policy crew_events_select on public.crew_events
  for select using (
    (exists (select 1 from crews c where c.id = crew_id and c.is_public)
     or is_crew_member(crew_id) or is_admin())
    and (not members_only or is_crew_full_member(crew_id) or is_admin())
  );

create or replace function public.crew_event_detail(p_event uuid)
returns table(
  id uuid, slug text, title text, description text, kind text,
  starts_at timestamptz, ends_at timestamptz, location text, capacity integer,
  going_names text[], maybe_names text[], declined_count bigint,
  my_status text, is_staff boolean
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
         is_crew_staff(e.crew_id)
  from crew_events e
  join crews c on c.id = e.crew_id
  where e.id = p_event
    and e.cancelled_at is null
    and (c.is_public or is_crew_member(c.id))
    and (not e.members_only or is_crew_full_member(e.crew_id));
$$;

-- crew_calendar: 정회원 전용 모임 필터 + members_only 플래그 (반환형 변경 → 재생성)
drop function if exists public.crew_calendar(text, date, date);
create function public.crew_calendar(
  p_slug text, p_from date, p_to date
)
returns table(
  kind text,
  on_date date,
  starts_at timestamptz,
  ref_id uuid,
  title text,
  subtitle text,
  member_id uuid,
  member_name text,
  going_count bigint,
  my_status text,
  result_ms bigint,
  members_only boolean
)
language sql stable security definer set search_path to 'public' as $$
  with c as (
    select id, is_public from crews
    where slug = p_slug and status = 'active'
  ), ok as (
    select 1 from c where c.is_public or is_crew_member(c.id)
  ),
  meetups as (
    select 'meetup'::text as kind,
           (e.starts_at at time zone 'Asia/Seoul')::date as on_date,
           e.starts_at, e.id as ref_id, e.title,
           coalesce(e.location, '') as subtitle,
           null::uuid as member_id, null::text as member_name,
           (select count(*) from crew_event_rsvps r
              where r.event_id = e.id and r.status = 'going') as going_count,
           (select r.status from crew_event_rsvps r
              where r.event_id = e.id and r.user_id = auth.uid()) as my_status,
           null::bigint as result_ms,
           e.members_only
    from crew_events e join c on c.id = e.crew_id
    where e.cancelled_at is null
      and (e.starts_at at time zone 'Asia/Seoul')::date between p_from and p_to
      and (not e.members_only or is_crew_full_member(c.id))
  ),
  races as (
    select 'race'::text, rp.race_date, null::timestamptz, rp.id,
           rp.title, coalesce(rp.note, ''),
           rp.user_id, coalesce(pr.display_name, 'Athlete'),
           null::bigint, null::text,
           (select r.total_time_ms from race_results r
              where r.user_id = rp.user_id
                and r.event_date between rp.race_date - 3 and rp.race_date + 3
              order by r.total_time_ms asc nulls last
              limit 1),
           false
    from race_plans rp
    join crew_members m on m.user_id = rp.user_id and m.status = 'active'
    join c on c.id = m.crew_id
    join profiles pr on pr.id = rp.user_id
    where rp.race_date between p_from and p_to
  ),
  progs as (
    select pe.program_id, p.title as ptitle, pe.start_date as pstart,
           least(coalesce(pe.end_date, p_to), p_to) as pend,
           p.repeat_enabled,
           (select max(d.day_index) from program_days d
              where d.program_id = p.id) as cyc
    from crew_program_enrollments pe
    join c on c.id = pe.crew_id
    join programs p on p.id = pe.program_id
  ),
  prog_days as (
    select pr.program_id, pr.ptitle, gs.d::date as on_date,
           case
             when pr.repeat_enabled and coalesce(pr.cyc, 0) > 0
               then ((gs.d::date - pr.pstart) % pr.cyc) + 1
             else (gs.d::date - pr.pstart) + 1
           end as day_idx
    from progs pr
    cross join lateral generate_series(
      greatest(pr.pstart, p_from)::timestamp,
      pr.pend::timestamp,
      interval '1 day'
    ) gs(d)
  ),
  program_rows as (
    select 'program'::text, pd.on_date, null::timestamptz, pd.program_id,
           pd.ptitle || ' D' || pd.day_idx,
           coalesce(d.focus, ''),
           null::uuid, null::text, null::bigint, null::text, null::bigint,
           false
    from prog_days pd
    join program_days d on d.program_id = pd.program_id and d.day_index = pd.day_idx
  )
  select * from meetups where exists (select 1 from ok)
  union all
  select * from races where exists (select 1 from ok)
  union all
  select * from program_rows where exists (select 1 from ok)
  order by on_date asc, starts_at asc nulls last;
$$;
grant execute on function public.crew_calendar(text, date, date) to anon, authenticated;

-- ---------- MCP 반영
-- 회계: 정회원 전용
create or replace function public.mcp_crew_finance(
  p_token text, p_slug text, p_month text default null
)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with u as (select mcp_uid(p_token) as id),
  c as (
    select c.id, c.name from crews c
    join crew_members m on m.crew_id = c.id
      and m.user_id = (select id from u) and m.status = 'active'
      and m.role <> 'associate'
    where c.slug = p_slug and c.status = 'active'),
  mo as (
    select case when p_month ~ '^\d{4}-\d{2}$' then p_month
                else to_char(current_date, 'YYYY-MM') end as m),
  rng as (
    select (m || '-01')::date as f,
           ((m || '-01')::date + interval '1 month' - interval '1 day')::date as t
    from mo)
  select jsonb_build_object(
    'crew', (select name from c),
    'month', (select m from mo),
    'month_income', coalesce((select sum(amount) from crew_ledger
      where crew_id = (select id from c) and kind = 'income'
        and entry_date between (select f from rng) and (select t from rng)), 0),
    'month_expense', coalesce((select sum(amount) from crew_ledger
      where crew_id = (select id from c) and kind = 'expense'
        and entry_date between (select f from rng) and (select t from rng)), 0),
    'total_balance', coalesce((select sum(case when kind = 'income' then amount
                                               else -amount end)
      from crew_ledger where crew_id = (select id from c)), 0),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', l.entry_date, 'kind', l.kind, 'amount', l.amount,
        'title', l.title, 'memo', l.memo) order by l.entry_date desc)
      from crew_ledger l
      where l.crew_id = (select id from c)
        and l.entry_date between (select f from rng) and (select t from rng)),
      '[]'::jsonb)
  )
  from c;
$$;

-- 크루 일정: 정회원 전용 모임 필터
create or replace function public.mcp_crew_schedule(
  p_token text, p_slug text,
  p_from date default current_date, p_to date default current_date + 30
)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with u as (select mcp_uid(p_token) as id),
  c as (
    select c.id, c.name,
      exists (select 1 from crew_members m
        where m.crew_id = c.id and m.user_id = (select id from u)
          and m.status = 'active' and m.role <> 'associate') as full_member
    from crews c
    where c.slug = p_slug and c.status = 'active'
      and (c.is_public or exists (
        select 1 from crew_members m
        where m.crew_id = c.id and m.user_id = (select id from u)
          and m.status = 'active')))
  select jsonb_build_object(
    'crew', (select name from c),
    'from', p_from, 'to', p_to,
    'meetups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', e.title, 'starts_at', e.starts_at, 'location', e.location,
        'members_only', e.members_only,
        'going', (select count(*) from crew_event_rsvps r
                  where r.event_id = e.id and r.status = 'going'))
        order by e.starts_at)
      from crew_events e where e.crew_id = (select id from c)
        and e.cancelled_at is null
        and (not e.members_only or (select full_member from c))
        and (e.starts_at at time zone 'Asia/Seoul')::date between p_from and p_to),
      '[]'::jsonb),
    'member_races', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', rp.title, 'race_date', rp.race_date,
        'member', pr.display_name,
        'result_ms', (select r.total_time_ms from race_results r
                      where r.user_id = rp.user_id
                        and r.event_date between rp.race_date - 3 and rp.race_date + 3
                      order by r.total_time_ms asc nulls last limit 1))
        order by rp.race_date)
      from race_plans rp
      join crew_members m on m.user_id = rp.user_id
        and m.crew_id = (select id from c) and m.status = 'active'
      join profiles pr on pr.id = rp.user_id
      where rp.race_date between p_from and p_to), '[]'::jsonb),
    'crew_programs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', p.title, 'start_date', pe.start_date,
        'end_date', pe.end_date, 'repeats', p.repeat_enabled))
      from crew_program_enrollments pe
      join programs p on p.id = pe.program_id
      where pe.crew_id = (select id from c)), '[]'::jsonb)
  )
  from c;
$$;

-- 오늘의 크루 모임: 정회원 전용 필터
create or replace function public.mcp_today(p_token text)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with u as (select mcp_uid(p_token) as id),
  en as (
    select pe.start_date, p.id as pid, p.title, p.end_date, p.repeat_enabled,
           (select max(d.day_index) from program_days d where d.program_id = p.id) as cyc
    from program_enrollments pe join programs p on p.id = pe.program_id
    where pe.user_id = (select id from u) and pe.active limit 1),
  prog as (
    select e.pid, e.title,
      case
        when e.end_date is not null and current_date > e.end_date then null
        when current_date < e.start_date then null
        when e.repeat_enabled and coalesce(e.cyc, 0) > 0
          then ((current_date - e.start_date) % e.cyc) + 1
        when (current_date - e.start_date) < coalesce(e.cyc, 0)
          then (current_date - e.start_date) + 1
        else null
      end as day_idx
    from en e)
  select jsonb_build_object(
    'today_program', (
      select jsonb_build_object(
        'program', pr.title, 'day', pr.day_idx, 'focus', d.focus,
        'workouts', coalesce((
          select jsonb_agg(jsonb_build_object('title', w.title, 'type', w.type))
          from workout_templates w where w.program_day_id = d.id), '[]'::jsonb))
      from prog pr
      join program_days d on d.program_id = pr.pid and d.day_index = pr.day_idx
      where pr.day_idx is not null),
    'crew_meetups_14d', coalesce((
      select jsonb_agg(jsonb_build_object(
        'crew', c.name, 'title', e.title, 'starts_at', e.starts_at,
        'location', e.location) order by e.starts_at)
      from crew_events e
      join crews c on c.id = e.crew_id
      join crew_members m on m.crew_id = c.id
        and m.user_id = (select id from u) and m.status = 'active'
      where e.cancelled_at is null
        and (not e.members_only or m.role <> 'associate')
        and e.starts_at between now() and now() + interval '14 days'), '[]'::jsonb),
    'my_race_plans_30d', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', rp.title, 'race_date', rp.race_date, 'note', rp.note)
        order by rp.race_date)
      from race_plans rp
      where rp.user_id = (select id from u)
        and rp.race_date between current_date and current_date + 30), '[]'::jsonb)
  )
  from u where u.id is not null;
$$;
