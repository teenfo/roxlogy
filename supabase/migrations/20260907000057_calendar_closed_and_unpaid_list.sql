-- ============================================================
-- Roxlogy — 일정 목록의 "종료됨" 표시 + 미납 내역 목록
--
-- (1) crew_calendar 가 closed_at 을 내려주지 않아, 어떤 모임이 종료됐는지
--     목록에서는 알 수 없고 상세를 열어야 했다. closed 플래그를 추가한다.
-- (2) 크루원 통계의 미납 카드에서 바로 내역을 열 수 있게 미납 목록을 함께
--     내린다. 미납은 이번 달 것만이 아니라서 회계 탭(월별 보드)으로는 한 번에
--     볼 수 없다 — 기간 무관으로 모으되 200건에서 끊는다.
--     확정·면제된 건은 미납이 아니므로 빠진다.
-- ============================================================

drop function if exists public.crew_calendar(text, date, date);
create function public.crew_calendar(p_slug text, p_from date, p_to date)
returns table(
  kind text, on_date date, starts_at timestamptz, ref_id uuid, title text,
  subtitle text, member_id uuid, member_name text, going_count bigint,
  my_status text, result_ms bigint, members_only boolean, fee_exempt boolean,
  closed boolean
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
           e.members_only, e.fee_exempt,
           e.closed_at is not null
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
           false, false, false
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
           false, false, false
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

create or replace function public.crew_member_stats(p_slug text)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with c as (
    select id from crews
     where slug = p_slug and ((select is_crew_staff(id)) or (select is_admin()))
  ),
  win as (select (app_today() - 29)::date as from_d, app_today() as to_d),
  ev as (
    select e.id from crew_events e, c, win w
     where e.crew_id = c.id and e.cancelled_at is null
       and (e.starts_at at time zone 'Asia/Seoul')::date between w.from_d and w.to_d
  )
  select jsonb_build_object(
    'members', (select count(*) from crew_members m, c
                 where m.crew_id = c.id and m.status = 'active'),
    'pending', (select count(*) from crew_members m, c
                 where m.crew_id = c.id and m.status = 'pending'),
    'joined_30d', (select count(*) from crew_members m, c, win w
                    where m.crew_id = c.id and m.status = 'active'
                      and (m.joined_at at time zone 'Asia/Seoul')::date >= w.from_d),
    'tiers', coalesce((
      select jsonb_agg(jsonb_build_object('name', t.name, 'color', t.color, 'count', x.n)
                       order by t.sort_order, t.name)
      from crew_member_tiers t
      join c on c.id = t.crew_id
      join lateral (
        select count(*) as n from crew_members m
         where m.tier_id = t.id and m.status = 'active'
      ) x on true
      where t.archived_at is null or x.n > 0), '[]'::jsonb),
    'meetups_30d', (select count(*) from ev),
    'attend_30d', (select count(*) from crew_event_rsvps r
                    where r.event_id in (select id from ev) and r.checked_in_at is not null),
    'attenders_30d', (select count(distinct r.user_id) from crew_event_rsvps r
                       where r.event_id in (select id from ev) and r.checked_in_at is not null),
    'trained_30d', (select count(distinct s.user_id)
                     from sessions s
                     join crew_members m on m.user_id = s.user_id and m.status = 'active'
                     join c on c.id = m.crew_id, win w
                     where s.deleted_at is null
                       and (s.started_at at time zone 'Asia/Seoul')::date between w.from_d and w.to_d),
    'unpaid_amount', coalesce((select sum(ch.amount) from crew_dues_charges ch, c
                                where ch.crew_id = c.id
                                  and ch.status in ('pending', 'reported')), 0),
    'unpaid_count', (select count(*) from crew_dues_charges ch, c
                      where ch.crew_id = c.id
                        and ch.status in ('pending', 'reported')),
    'waived_amount', coalesce((select sum(ch.amount) from crew_dues_charges ch, c
                                where ch.crew_id = c.id and ch.status = 'waived'), 0),
    'unpaid_list', coalesce((
      select jsonb_agg(x order by x.name, x.period desc, x.label)
      from (
        select ch.id as charge_id, ch.user_id,
               coalesce(p.display_name, 'Athlete') as name,
               ch.period, ch.kind, ch.label, ch.amount, ch.status
        from crew_dues_charges ch
        join c on c.id = ch.crew_id
        join profiles p on p.id = ch.user_id
        where ch.status in ('pending', 'reported')
        order by coalesce(p.display_name, 'Athlete'), ch.period desc, ch.label
        limit 200
      ) x), '[]'::jsonb)
  )
  from c;
$$;
grant execute on function public.crew_member_stats(text) to authenticated;

do $$
declare n int;
begin
  select count(*) into n
  from pg_proc p, unnest(p.proargnames) as a(nm)
  where p.pronamespace = 'public'::regnamespace and p.proname = 'crew_calendar'
    and a.nm = 'closed';
  if n <> 1 then raise exception '가드: crew_calendar 에 closed 가 없습니다'; end if;

  if position('unpaid_list' in
       (select pg_get_functiondef(oid) from pg_proc
         where pronamespace = 'public'::regnamespace and proname = 'crew_member_stats')) = 0 then
    raise exception '가드: 통계에 unpaid_list 가 없습니다';
  end if;
end $$;
