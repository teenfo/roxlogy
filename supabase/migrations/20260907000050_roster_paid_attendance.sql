-- ============================================================
-- Roxlogy — 크루원 명단의 출석 횟수를 유료/전체로 나눠 표시
--
-- 무료 행사(fee_exempt)가 생기면서 "출석 8회"만으로는 회비가 걸린 참석이
-- 몇 번인지 알 수 없게 됐다. 두 숫자를 나눠 내린다:
--   attend_paid_count — 유료 모임(fee_exempt = false) 출석
--   attend_count      — 무료 포함 전체 출석
-- 기준은 모임이 유료인지이고, 그 사람 등급에 회차비가 있었는지는 보지 않는다
-- (등급 요금은 나중에 바뀔 수 있어 출석 이력의 기준으로 삼기에 불안정하다).
-- 둘 다 크루 내부 활동이라 공개 크루라도 비회원에게는 null 로 내린다.
-- ============================================================

drop function if exists public.crew_roster(text, integer);
create function public.crew_roster(p_slug text, p_limit integer default 100)
returns table(
  user_id uuid, display_name text, email text, division text, role text,
  joined_at timestamptz, session_count bigint,
  attend_count bigint, attend_paid_count bigint,
  tier_id uuid, tier_name text, tier_color text
)
language sql stable security definer set search_path to 'public' as $$
  select m.user_id,
         coalesce(p.display_name, 'Athlete'),
         case when (select is_crew_staff(c.id)) or (select is_admin())
              then u.email::text else null end,
         p.division, m.role, m.joined_at,
         (select count(*) from sessions s
            where s.user_id = m.user_id and s.deleted_at is null),
         case when (select is_crew_member(c.id)) or (select is_admin()) then
           (select count(*) from crew_event_rsvps r
              join crew_events e on e.id = r.event_id
             where r.user_id = m.user_id and e.crew_id = c.id
               and e.cancelled_at is null and r.checked_in_at is not null)
         else null::bigint end,
         case when (select is_crew_member(c.id)) or (select is_admin()) then
           (select count(*) from crew_event_rsvps r
              join crew_events e on e.id = r.event_id
             where r.user_id = m.user_id and e.crew_id = c.id
               and e.cancelled_at is null and not e.fee_exempt
               and r.checked_in_at is not null)
         else null::bigint end,
         t.id, t.name, t.color
  from crew_members m
  join crews c on c.id = m.crew_id
  join profiles p on p.id = m.user_id
  left join auth.users u on u.id = m.user_id
  left join crew_member_tiers t on t.id = m.tier_id
  where c.slug = p_slug and m.status = 'active'
    and (c.is_public or (select is_crew_member(c.id)))
  order by array_position(array['owner','coach'], m.role),
           coalesce(t.sort_order, 99), coalesce(t.name, ''), m.joined_at
  limit least(p_limit, 500);
$$;
grant execute on function public.crew_roster(text, integer) to anon, authenticated;

do $$
declare n int; v_def text;
begin
  select count(*) into n
  from pg_proc p, unnest(p.proargnames) as a(nm)
  where p.pronamespace = 'public'::regnamespace and p.proname = 'crew_roster'
    and a.nm in ('attend_count', 'attend_paid_count');
  if n <> 2 then raise exception '가드: crew_roster 에 출석 컬럼 2종이 없습니다 (%)', n; end if;

  -- 유료 집계는 무료 행사를 빼야 한다
  select pg_get_functiondef(oid) into v_def from pg_proc
   where pronamespace = 'public'::regnamespace and proname = 'crew_roster';
  if v_def not like '%not e.fee_exempt%' then
    raise exception '가드: 유료 출석 집계가 무료 행사를 빼지 않습니다';
  end if;

  -- 이메일은 여전히 스태프 게이트를 지나야 한다 (익명도 부르는 함수)
  if v_def not like '%is_crew_staff(c.id)) or (select is_admin())%then u.email%' then
    raise exception '가드: crew_roster 의 이메일 게이트가 사라졌습니다';
  end if;
end $$;
