-- ============================================================
-- Roxlogy — 크루 일정표 (모임 RSVP · 대회 참가 · 크루 프로그램)
--
-- 크루 일정 탭은 세 소스를 한 캘린더로 합친다:
--   1. 모임(crew_events, 기존 테이블 재사용) — 스태프 등록, 멤버 RSVP
--   2. 대회 참가(race_plans, 신규) — 멤버가 자기 참가 대회를 등록
--   3. 크루 훈련(crew_program_enrollments, 신규) — 스태프가 트레이닝
--      프로그램을 크루에 연결하면 일차가 날짜별로 전개된다
--      (반복 규칙은 개인 스케줄과 동일: 경과일 mod 사이클 + 1)
-- 조회는 crew_calendar() SECURITY DEFINER RPC 하나로 — 공개 크루
-- 또는 멤버만. race_plans 자체는 본인 행만 직접 접근 가능.
-- ============================================================

-- 1. 대회 참가 일정 -----------------------------------------------------------

create table if not exists public.race_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  race_date date not null,
  race_event_id uuid references public.race_events(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists race_plans_user_idx on public.race_plans(user_id, race_date);

alter table public.race_plans enable row level security;

drop policy if exists race_plans_own on public.race_plans;
create policy race_plans_own on public.race_plans
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 2. 크루 프로그램 연결 -------------------------------------------------------

create table if not exists public.crew_program_enrollments (
  crew_id uuid not null references public.crews(id) on delete cascade,
  program_id uuid not null references public.programs(id) on delete cascade,
  start_date date not null,
  end_date date,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (crew_id, program_id)
);

alter table public.crew_program_enrollments enable row level security;

drop policy if exists crew_prog_select_member on public.crew_program_enrollments;
create policy crew_prog_select_member on public.crew_program_enrollments
  for select using (is_crew_member(crew_id) or is_admin());

drop policy if exists crew_prog_write_staff on public.crew_program_enrollments;
create policy crew_prog_write_staff on public.crew_program_enrollments
  for all using (is_crew_staff(crew_id)) with check (is_crew_staff(crew_id));

-- 3. 통합 캘린더 RPC ----------------------------------------------------------

create or replace function public.crew_calendar(
  p_slug text, p_from date, p_to date
)
returns table(
  kind text,            -- 'meetup' | 'race' | 'program'
  on_date date,
  starts_at timestamptz,
  ref_id uuid,          -- meetup: crew_events.id / race: race_plans.id / program: programs.id
  title text,
  subtitle text,
  member_id uuid,       -- race: 등록한 멤버
  member_name text,
  going_count bigint,   -- meetup 전용
  my_status text        -- meetup 전용 (going/maybe/declined)
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
              where r.event_id = e.id and r.user_id = auth.uid()) as my_status
    from crew_events e join c on c.id = e.crew_id
    where e.cancelled_at is null
      and (e.starts_at at time zone 'Asia/Seoul')::date between p_from and p_to
  ),
  races as (
    select 'race'::text, rp.race_date, null::timestamptz, rp.id,
           rp.title, coalesce(rp.note, ''),
           rp.user_id, coalesce(pr.display_name, 'Athlete'),
           null::bigint, null::text
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
           null::uuid, null::text, null::bigint, null::text
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

-- 4. 모임 상세 RPC (RSVP 명단 포함) -------------------------------------------

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
    and (c.is_public or is_crew_member(c.id));
$$;

grant execute on function public.crew_event_detail(uuid) to anon, authenticated;
