-- ============================================================
-- Roxlogy — 대회 참가 일정에 디비전·BIB 추가
--
-- BIB 4+2 규약(앞 4자리 = 웨이브 출발시각 HHMM, 뒤 2자리 = 순번)을 이용해
-- 일정표에서 같은 날짜의 대회 참가를 출발시각 순으로 정렬한다.
-- BIB 는 대회 직전에 발급되는 경우가 많아 나중에 수정(백필)할 수 있다.
-- ============================================================

alter table public.race_plans
  add column if not exists division text
    check (division is null or char_length(division) <= 40);
alter table public.race_plans
  add column if not exists bib text
    check (bib is null or bib ~ '^\d{4,8}$');

-- crew_calendar: 대회 행의 starts_at 을 BIB 에서 유도(6자리·유효한 HHMM 일 때,
-- Asia/Seoul 기준), subtitle 에 디비전을 합류. 반환형 동일 → replace.
create or replace function public.crew_calendar(
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
    select 'race'::text, rp.race_date,
           -- BIB 4+2: 앞 4자리가 유효한 HHMM 이면 출발시각으로 (KST)
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
