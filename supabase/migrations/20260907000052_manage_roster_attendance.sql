-- ============================================================
-- Roxlogy — 관리 > 크루원 명단에도 출석 횟수(유료/전체)
--
-- 공개 크루원 탭에는 이미 나오는데 운영진이 실제로 등급을 바꾸고 승인하는
-- 관리 화면에는 없어서, 판단하려면 탭을 왔다 갔다 해야 했다.
-- crew_roster 와 같은 규칙으로 두 숫자를 내린다 (유료 = fee_exempt 아닌 모임).
-- ============================================================

drop function if exists public.crew_manage_roster(text);
create function public.crew_manage_roster(p_slug text)
returns table(
  user_id uuid, display_name text, email text, role text, status text,
  joined_at timestamptz, tier_id uuid, tier_name text, tier_color text,
  attend_count bigint, attend_paid_count bigint
)
language sql stable security definer set search_path to 'public' as $$
  select m.user_id, coalesce(p.display_name, 'Athlete'), u.email::text, m.role, m.status,
         m.joined_at, t.id, t.name, t.color,
         (select count(*) from crew_event_rsvps r
            join crew_events e on e.id = r.event_id
           where r.user_id = m.user_id and e.crew_id = c.id
             and e.cancelled_at is null and r.checked_in_at is not null),
         (select count(*) from crew_event_rsvps r
            join crew_events e on e.id = r.event_id
           where r.user_id = m.user_id and e.crew_id = c.id
             and e.cancelled_at is null and not e.fee_exempt
             and r.checked_in_at is not null)
  from crew_members m
  join crews c on c.id = m.crew_id
  join profiles p on p.id = m.user_id
  left join auth.users u on u.id = m.user_id
  left join crew_member_tiers t on t.id = m.tier_id
  where c.slug = p_slug and ((select is_crew_staff(c.id)) or (select is_admin()))
  order by case m.status when 'pending' then 0 else 1 end,
           array_position(array['owner','coach'], m.role),
           coalesce(t.sort_order, 99), coalesce(t.name, ''), m.joined_at;
$$;
grant execute on function public.crew_manage_roster(text) to authenticated;

do $$
declare n int; v_def text;
begin
  select count(*) into n
  from pg_proc p, unnest(p.proargnames) as a(nm)
  where p.pronamespace = 'public'::regnamespace and p.proname = 'crew_manage_roster'
    and a.nm in ('attend_count', 'attend_paid_count');
  if n <> 2 then raise exception '가드: 관리 명단에 출석 컬럼 2종이 없습니다 (%)', n; end if;

  select pg_get_functiondef(oid) into v_def from pg_proc
   where pronamespace = 'public'::regnamespace and proname = 'crew_manage_roster';
  if v_def not like '%not e.fee_exempt%' then
    raise exception '가드: 유료 출석 집계가 무료 행사를 빼지 않습니다';
  end if;
  -- 스태프 게이트가 남아 있어야 이메일이 새지 않는다
  if v_def not like '%is_crew_staff(c.id)%' then
    raise exception '가드: 관리 명단의 스태프 게이트가 사라졌습니다';
  end if;
end $$;
