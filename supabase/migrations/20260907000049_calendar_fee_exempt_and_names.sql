-- ============================================================
-- Roxlogy — 일정표에 무료 행사 표시 + 가입 시 이름 확보
--
-- (1) crew_calendar 가 무료 행사 여부를 내려주지 않아, 목록에서는 어떤 모임이
--     무료인지 열어 봐야만 알 수 있었다. fee_exempt 를 추가한다.
--
-- (2) handle_new_user 가 raw_user_meta_data->>'display_name' 만 보는데 가입
--     폼이 그 값을 넣지 않아 모든 신규 계정의 display_name 이 null 이었다.
--     그래서 명단·출석·회비 화면이 전부 'Athlete' 로만 보였다(운영진이
--     이메일을 병기해 달라고 한 이유). 구글 로그인은 full_name/name 을 이미
--     주고 있으므로 폴백을 추가하고, 이미 만들어진 계정도 같은 값으로 채운다.
-- ============================================================

-- 반환 컬럼이 늘어나므로 drop 후 재정의
drop function if exists public.crew_calendar(text, date, date);
create function public.crew_calendar(p_slug text, p_from date, p_to date)
returns table(
  kind text, on_date date, starts_at timestamptz, ref_id uuid, title text,
  subtitle text, member_id uuid, member_name text, going_count bigint,
  my_status text, result_ms bigint, members_only boolean, fee_exempt boolean
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
           e.members_only,
           e.fee_exempt
    from crew_events e join c on c.id = e.crew_id
    where e.cancelled_at is null
      and (e.starts_at at time zone 'Asia/Seoul')::date between p_from and p_to
      and (not e.members_only or is_crew_full_member(c.id))
  ),
  races as (
    select 'race'::text, rp.race_date,
           case
             when rp.bib ~ '^\d{6}$'
                  and substring(rp.bib, 1, 2)::int < 24
                  and substring(rp.bib, 3, 2)::int < 60
             then (rp.race_date::timestamp
                   + make_interval(
                       hours => substring(rp.bib, 1, 2)::int,
                       mins  => substring(rp.bib, 3, 2)::int))
                  at time zone 'Asia/Seoul'
             else null
           end,
           rp.id, rp.title,
           coalesce(
             concat_ws(' · ', nullif(rp.division, ''), nullif(rp.note, '')),
             ''),
           rp.user_id, coalesce(pr.display_name, 'Athlete'),
           null::bigint, null::text,
           (select r.total_time_ms from race_results r
              where r.user_id = rp.user_id
                and r.event_date between rp.race_date - 3 and rp.race_date + 3
              order by r.total_time_ms asc nulls last
              limit 1),
           false, false
    from race_plans rp
    join crew_members m on m.user_id = rp.user_id and m.status = 'active'
    join c on c.id = m.crew_id
    join profiles pr on pr.id = rp.user_id
    where rp.race_date between p_from and p_to
  ),
  progs as (
    select pe.program_id, p.title as ptitle, pe.start_date as pstart,
           least(coalesce(pe.end_date, p_to), p_to) as pend,
           pe.repeat as repeat_enabled,
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
           false, false
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

-- 가입 시 이름 --------------------------------------------------------------
-- 구글 로그인은 full_name / name 을 준다. 이메일 가입은 폼이 display_name 을
-- 넣도록 함께 고쳤다. 셋 다 없으면 여전히 null (화면이 'Athlete' 로 폴백).
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(btrim(coalesce(
      new.raw_user_meta_data->>'display_name',
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      ''
    )), '')
  );
  return new;
end;
$$;

-- 이미 만들어진 계정 채우기 — 비어 있는 것만, 본인이 준 이름으로.
update public.profiles p
   set display_name = nullif(btrim(coalesce(
         u.raw_user_meta_data->>'display_name',
         u.raw_user_meta_data->>'full_name',
         u.raw_user_meta_data->>'name',
         ''
       )), '')
  from auth.users u
 where u.id = p.id
   and (p.display_name is null or btrim(p.display_name) = '')
   and nullif(btrim(coalesce(
         u.raw_user_meta_data->>'display_name',
         u.raw_user_meta_data->>'full_name',
         u.raw_user_meta_data->>'name',
         '')), '') is not null;

do $$
declare n int;
begin
  select count(*) into n
  from pg_proc p, unnest(p.proargnames) as a(nm)
  where p.pronamespace = 'public'::regnamespace and p.proname = 'crew_calendar'
    and a.nm = 'fee_exempt';
  if n <> 1 then raise exception '가드: crew_calendar 에 fee_exempt 가 없습니다'; end if;

  if position('full_name' in
       (select pg_get_functiondef(oid) from pg_proc
         where pronamespace = 'public'::regnamespace and proname = 'handle_new_user')) = 0 then
    raise exception '가드: handle_new_user 가 구글 이름을 받지 않습니다';
  end if;
end $$;
