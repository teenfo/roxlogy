-- 크루 캘린더의 대회 행에 공식 대회 id 를 실어 준다.
--
-- 크루원이 등록한 "내 대회일정"은 지금까지 클릭할 곳이 없었다. 공식 대회에
-- 연결된 계획이면 그 대회 페이지(/events/[id])로 보낼 수 있다 — 장소·일시·
-- 공식 링크와 라이브 결과가 이미 거기 있다.
--
-- 반환 컬럼이 늘어나므로 create or replace 로는 안 되고 drop 후 생성한다.
-- 컬럼 추가는 옛 번들이 무시하고 지나가므로 배포 순서를 신경 쓰지 않아도 된다.
drop function if exists public.crew_calendar(text, date, date);

create function public.crew_calendar(p_slug text, p_from date, p_to date)
returns table(kind text, on_date date, starts_at timestamptz, ref_id uuid,
              title text, subtitle text, member_id uuid, member_name text,
              going_count bigint, my_status text, result_ms bigint,
              members_only boolean, fee_exempt boolean, closed boolean,
              event_id uuid)
language sql
stable
security definer
set search_path = public
as $$
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
           e.members_only, e.fee_exempt,
           e.closed_at is not null,
           null::uuid as event_id
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
           false, false, false,
           rp.race_event_id
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
           false, false, false, null::uuid
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

-- 검증 — 공식 대회에 연결된 계획이 있으면 event_id 가 실려 나온다
do $$
declare
  v_slug text;
  v_from date;
  v_to date;
  v_linked int;
  v_expect int;
begin
  select c.slug, min(rp.race_date), max(rp.race_date)
    into v_slug, v_from, v_to
    from race_plans rp
    join crew_members m on m.user_id = rp.user_id and m.status = 'active'
    join crews c on c.id = m.crew_id
   where rp.race_event_id is not null and c.status = 'active'
   group by c.slug limit 1;
  if v_slug is null then
    raise notice 'no linked race plans — skipping guard';
    return;
  end if;

  select count(*) into v_linked
    from crew_calendar(v_slug, v_from, v_to)
   where kind = 'race' and event_id is not null;
  select count(*) into v_expect
    from race_plans rp
    join crew_members m on m.user_id = rp.user_id and m.status = 'active'
    join crews c on c.id = m.crew_id and c.slug = v_slug
   where rp.race_event_id is not null
     and rp.race_date between v_from and v_to;

  if v_linked <> v_expect then
    raise exception 'event_id missing: got % want %', v_linked, v_expect;
  end if;
end $$;
