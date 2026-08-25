-- ============================================================
-- Roxlogy — 크루 일정에 대회 결과 표시
--
-- 크루원의 대회 일정(race_plans)이 끝나고 공식 기록이 등록되면
-- (P2 자동 임포트 또는 수동 입력), 크루 일정표의 대회 항목에 기록을
-- 함께 보여준다. 대회 날짜 ±3일 내 같은 사용자의 race_results 중
-- 최고 기록 1건. 반환형 변경이므로 drop 후 재생성.
-- ============================================================

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
  result_ms bigint      -- race 전용: 등록된 공식/수동 레이스 기록
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
           null::bigint as result_ms
    from crew_events e join c on c.id = e.crew_id
    where e.cancelled_at is null
      and (e.starts_at at time zone 'Asia/Seoul')::date between p_from and p_to
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
              limit 1)
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
           null::uuid, null::text, null::bigint, null::text, null::bigint
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
