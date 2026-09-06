-- ============================================================
-- Roxlogy — 크루원 목록에 계정 주소
--
-- display_name 을 설정하지 않은 크루원이 전부 'Athlete' 로 보여 목록에서
-- 구분이 안 된다. crew_roster 에 email 을 추가한다.
--
-- crew_roster 는 공개 크루면 익명도 부르는 함수다. 이메일은 반드시
-- 운영진·관리자에게만 나가야 하므로 컬럼 자체를 게이트로 감싼다
-- (crew_manage_roster·crew_event_attendance 와 같은 원칙).
-- ============================================================

drop function if exists public.crew_roster(text, integer);
create function public.crew_roster(p_slug text, p_limit integer default 100)
returns table(
  user_id uuid, display_name text, email text, division text, role text,
  joined_at timestamptz, session_count bigint, attend_count bigint,
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
declare n int;
begin
  select count(*) into n
  from pg_proc p, unnest(p.proargnames) as a(nm)
  where p.pronamespace = 'public'::regnamespace and p.proname = 'crew_roster'
    and a.nm = 'email';
  if n <> 1 then raise exception '가드: crew_roster 에 email 출력 컬럼이 없습니다'; end if;

  -- 익명도 부르는 함수다 — 이메일은 반드시 스태프 게이트를 지나야 한다
  if not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'crew_roster'
      and p.prosecdef
      and pg_get_functiondef(p.oid) like '%is_crew_staff(c.id)) or (select is_admin())%then u.email%'
  ) then
    raise exception '가드: crew_roster 의 이메일에 스태프 게이트가 없습니다';
  end if;
end $$;
