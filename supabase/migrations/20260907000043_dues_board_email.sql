-- ============================================================
-- Roxlogy — 회비 보드에 계정 주소
--
-- 이름을 설정하지 않은 크루원이 전부 'Athlete' 로 보여 회비를 확정할 때
-- 누구 것인지 가릴 수 없다. 관리 명단·출석 명단과 같이 이메일을 병기한다.
--
-- crew_dues_board 는 WHERE 에서 이미 스태프만 통과시키지만(비스태프는 0행),
-- 나중에 그 조건이 느슨해져도 이메일이 새지 않도록 컬럼에도 게이트를 건다.
-- ============================================================

drop function if exists public.crew_dues_board(text, text);
create function public.crew_dues_board(p_slug text, p_period text)
returns table(
  charge_id uuid, user_id uuid, display_name text, email text,
  tier_name text, tier_color text,
  kind text, label text, amount int, status text, event_at timestamptz
)
language sql stable security definer set search_path to 'public' as $$
  select ch.id, ch.user_id, coalesce(p.display_name, 'Athlete'),
         case when (select is_crew_staff(c.id)) or (select is_admin())
              then u.email::text else null end,
         t.name, t.color, ch.kind, ch.label, ch.amount, ch.status, e.starts_at
  from crew_dues_charges ch
  join crews c on c.id = ch.crew_id
  join profiles p on p.id = ch.user_id
  left join auth.users u on u.id = ch.user_id
  left join crew_member_tiers t on t.id = ch.tier_id
  left join crew_events e on e.id = ch.event_id
  where c.slug = p_slug and ch.period = p_period
    and ((select is_crew_staff(c.id)) or (select is_admin()))
  order by coalesce(p.display_name, 'Athlete'),
           case ch.kind when 'monthly' then 0 else 1 end, e.starts_at, ch.created_at;
$$;
grant execute on function public.crew_dues_board(text, text) to authenticated;

do $$
declare n int;
begin
  select count(*) into n
  from pg_proc p, unnest(p.proargnames) as a(nm)
  where p.pronamespace = 'public'::regnamespace and p.proname = 'crew_dues_board'
    and a.nm = 'email';
  if n <> 1 then raise exception '가드: crew_dues_board 에 email 출력 컬럼이 없습니다'; end if;

  if not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'crew_dues_board'
      and p.prosecdef
      and pg_get_functiondef(p.oid) like '%is_crew_staff(c.id)) or (select is_admin())%then u.email%'
  ) then
    raise exception '가드: crew_dues_board 의 이메일에 스태프 게이트가 없습니다';
  end if;

  if has_function_privilege('anon', 'public.crew_dues_board(text, text)', 'execute') then
    raise exception '가드: 회비 보드가 익명에 노출됐습니다';
  end if;
end $$;
