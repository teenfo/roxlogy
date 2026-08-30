-- ============================================================
-- Roxlogy — 모임 정원 + 대기열
--
-- 모임에 정원(capacity)이 있으면: 참석(going) 신청이 정원을 넘는 순간
-- 자동으로 대기(waitlisted)로 전환되고, 기존 참석자가 취소해 공석이
-- 생기면 대기열에서 먼저 신청한 순서(queued_at)대로 자동 승격된다.
-- 정원을 늘리거나 없애면 그만큼 대기자가 즉시 승격된다.
-- 트리거로 구현 — 웹 RSVP·MCP 등 모든 경로에서 동일하게 동작한다.
-- ============================================================

alter table public.crew_event_rsvps
  drop constraint if exists crew_event_rsvps_status_check;
alter table public.crew_event_rsvps
  add constraint crew_event_rsvps_status_check
    check (status in ('going', 'maybe', 'declined', 'waitlisted'));
alter table public.crew_event_rsvps
  add column if not exists queued_at timestamptz;

-- BEFORE: going 신청이 정원을 넘으면 waitlisted 로 전환 (대기 시각 기록)
create or replace function public.crew_rsvp_capacity_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  v_cap int;
  v_going int;
begin
  if new.status = 'going' then
    select capacity into v_cap from crew_events where id = new.event_id;
    if v_cap is not null then
      select count(*) into v_going from crew_event_rsvps r
      where r.event_id = new.event_id and r.status = 'going'
        and r.user_id <> new.user_id;
      if v_going >= v_cap then
        new.status := 'waitlisted';
      end if;
    end if;
  end if;
  if new.status = 'waitlisted' then
    new.queued_at := coalesce(new.queued_at, now());
  else
    new.queued_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists crew_rsvp_capacity_guard on public.crew_event_rsvps;
create trigger crew_rsvp_capacity_guard
  before insert or update on public.crew_event_rsvps
  for each row execute function public.crew_rsvp_capacity_guard();

-- AFTER: going 자리가 비면 대기 1순위부터 승격
create or replace function public.crew_rsvp_promote() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  v_event uuid := coalesce(old.event_id, new.event_id);
  v_cap int;
  v_going int;
  v_next uuid;
begin
  -- going 자리가 났을 때만 동작
  if tg_op = 'UPDATE' and not (old.status = 'going' and new.status <> 'going') then
    return null;
  end if;
  if tg_op = 'DELETE' and old.status <> 'going' then
    return null;
  end if;

  select capacity into v_cap from crew_events where id = v_event;
  if v_cap is null then return null; end if; -- 무제한이면 대기열 없음

  loop
    select count(*) into v_going from crew_event_rsvps
    where event_id = v_event and status = 'going';
    exit when v_going >= v_cap;
    select user_id into v_next from crew_event_rsvps
    where event_id = v_event and status = 'waitlisted'
    order by queued_at nulls first, created_at
    limit 1;
    exit when v_next is null;
    update crew_event_rsvps set status = 'going'
    where event_id = v_event and user_id = v_next;
  end loop;
  return null;
end;
$$;

drop trigger if exists crew_rsvp_promote on public.crew_event_rsvps;
create trigger crew_rsvp_promote
  after update or delete on public.crew_event_rsvps
  for each row execute function public.crew_rsvp_promote();

-- 정원 변경(증가·해제) 시 대기자 승격
create or replace function public.crew_event_capacity_promote() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  v_going int;
  v_next uuid;
begin
  if new.capacity is not distinct from old.capacity then return new; end if;
  loop
    if new.capacity is not null then
      select count(*) into v_going from crew_event_rsvps
      where event_id = new.id and status = 'going';
      exit when v_going >= new.capacity;
    end if;
    select user_id into v_next from crew_event_rsvps
    where event_id = new.id and status = 'waitlisted'
    order by queued_at nulls first, created_at
    limit 1;
    exit when v_next is null;
    update crew_event_rsvps set status = 'going'
    where event_id = new.id and user_id = v_next;
  end loop;
  return new;
end;
$$;

drop trigger if exists crew_event_capacity_promote on public.crew_events;
create trigger crew_event_capacity_promote
  after update of capacity on public.crew_events
  for each row execute function public.crew_event_capacity_promote();

-- crew_event_detail: 대기 명단 추가 (반환형 변경 → 재생성)
drop function if exists public.crew_event_detail(uuid);
create function public.crew_event_detail(p_event uuid)
returns table(
  id uuid, slug text, title text, description text, kind text,
  starts_at timestamptz, ends_at timestamptz, location text, capacity integer,
  going_names text[], maybe_names text[], declined_count bigint,
  my_status text, is_staff boolean,
  comments_allowed boolean, comments jsonb, waitlist_names text[]
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
            where cm.event_id = e.id and cm.deleted_at is null), '[]'::jsonb),
         coalesce((select array_agg(coalesce(pr.display_name, 'Athlete')
              order by r.queued_at nulls first, r.created_at)
            from crew_event_rsvps r join profiles pr on pr.id = r.user_id
            where r.event_id = e.id and r.status = 'waitlisted'), '{}')
  from crew_events e
  join crews c on c.id = e.crew_id
  where e.id = p_event
    and e.cancelled_at is null
    and (c.is_public or is_crew_member(c.id))
    and (not e.members_only or is_crew_full_member(e.crew_id));
$$;
grant execute on function public.crew_event_detail(uuid) to anon, authenticated;

-- MCP: 모임 등록에 정원 파라미터 (시그니처 변경 → 구버전 제거)
drop function if exists public.mcp_add_meetup(text, text, text, timestamptz, text, text, text);
create function public.mcp_add_meetup(
  p_token text, p_slug text, p_title text, p_starts_at timestamptz,
  p_location text default null, p_description text default null,
  p_kind text default 'social', p_capacity int default null
)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_crew uuid := mcp_staff_crew(p_token, p_slug);
  v_id uuid;
  v_kind text := case when p_kind in ('wod','race_sim','run','strength','social','race')
                      then p_kind else 'social' end;
begin
  if v_crew is null then return null; end if;
  if p_title is null or length(trim(p_title)) = 0 or p_starts_at is null then
    return jsonb_build_object('error', 'invalid_input');
  end if;
  if p_capacity is not null and p_capacity < 1 then
    return jsonb_build_object('error', 'invalid_capacity');
  end if;
  insert into crew_events (crew_id, title, kind, starts_at, location,
                           description, capacity, created_by)
  values (v_crew, left(trim(p_title), 120), v_kind, p_starts_at,
          nullif(left(trim(coalesce(p_location, '')), 120), ''),
          nullif(left(trim(coalesce(p_description, '')), 4000), ''),
          p_capacity, mcp_uid(p_token))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'event_id', v_id,
    'title', left(trim(p_title), 120), 'starts_at', p_starts_at,
    'kind', v_kind, 'capacity', p_capacity);
end;
$$;
grant execute on function
  public.mcp_add_meetup(text, text, text, timestamptz, text, text, text, int)
to anon, authenticated;

-- MCP: 모임 수정에 정원 파라미터 (0 = 정원 해제)
drop function if exists public.mcp_update_meetup(text, text, uuid, text, timestamptz, text, text, boolean, boolean, boolean);
create function public.mcp_update_meetup(
  p_token text, p_slug text, p_event uuid,
  p_title text default null, p_starts_at timestamptz default null,
  p_location text default null, p_description text default null,
  p_members_only boolean default null, p_comments_allowed boolean default null,
  p_cancel boolean default false, p_capacity int default null
)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_crew uuid := mcp_staff_crew(p_token, p_slug);
  r record;
begin
  if v_crew is null then return null; end if;
  if p_capacity is not null and p_capacity < 0 then
    return jsonb_build_object('error', 'invalid_capacity');
  end if;
  update crew_events e
  set title = coalesce(nullif(left(trim(coalesce(p_title, '')), 120), ''), e.title),
      starts_at = coalesce(p_starts_at, e.starts_at),
      location = case when p_location is null then e.location
                      else nullif(left(trim(p_location), 120), '') end,
      description = case when p_description is null then e.description
                         else nullif(left(trim(p_description), 4000), '') end,
      members_only = coalesce(p_members_only, e.members_only),
      comments_allowed = coalesce(p_comments_allowed, e.comments_allowed),
      capacity = case when p_capacity is null then e.capacity
                      when p_capacity = 0 then null else p_capacity end,
      cancelled_at = case when coalesce(p_cancel, false) then now() else e.cancelled_at end
  where e.id = p_event and e.crew_id = v_crew
  returning e.title, e.starts_at, e.location, e.members_only,
            e.comments_allowed, e.capacity, e.cancelled_at into r;
  if r is null then return jsonb_build_object('error', 'event_not_found'); end if;
  return jsonb_build_object('ok', true, 'title', r.title, 'starts_at', r.starts_at,
    'location', r.location, 'members_only', r.members_only,
    'comments_allowed', r.comments_allowed, 'capacity', r.capacity,
    'cancelled', r.cancelled_at is not null);
end;
$$;
grant execute on function
  public.mcp_update_meetup(text, text, uuid, text, timestamptz, text, text, boolean, boolean, boolean, int)
to anon, authenticated;

-- MCP: RSVP — 트리거가 대기로 전환할 수 있으므로 실제 저장 상태를 반환
create or replace function public.mcp_rsvp(
  p_token text, p_event uuid, p_status text
)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := mcp_uid(p_token);
  v_ok boolean;
  v_stored text;
  v_pos int;
begin
  if v_uid is null then return null; end if;
  if p_status not in ('going', 'maybe', 'declined') then
    return jsonb_build_object('error', 'invalid_status');
  end if;
  select true into v_ok from crew_events e
  join crew_members m on m.crew_id = e.crew_id
    and m.user_id = v_uid and m.status = 'active'
  where e.id = p_event and e.cancelled_at is null
    and (not e.members_only or m.role <> 'associate');
  if v_ok is null then return null; end if;

  insert into crew_event_rsvps (event_id, user_id, status)
  values (p_event, v_uid, p_status)
  on conflict (event_id, user_id) do update set status = excluded.status;

  select status into v_stored from crew_event_rsvps
  where event_id = p_event and user_id = v_uid;
  if v_stored = 'waitlisted' then
    select count(*) into v_pos from crew_event_rsvps r
    where r.event_id = p_event and r.status = 'waitlisted'
      and (r.queued_at, r.created_at) <= (
        select r2.queued_at, r2.created_at from crew_event_rsvps r2
        where r2.event_id = p_event and r2.user_id = v_uid);
  end if;

  return jsonb_build_object('ok', true, 'status', v_stored,
    'waitlist_position', v_pos,
    'going_count', (select count(*) from crew_event_rsvps r
                    where r.event_id = p_event and r.status = 'going'),
    'capacity', (select capacity from crew_events where id = p_event));
end;
$$;
