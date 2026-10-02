-- ============================================================
-- Roxlogy — 회원 목록: 리더·부리더를 다시 맨 위로 고정 (2026-10-02)
--
-- 118 에서 회원 목록을 등급(지정 순서) > 이름으로 바꿨는데, 리더(owner)·부리더(coach)는
-- 예전처럼 맨 위에 고정하기로 했다(사용자 지정). 최종 정렬:
--   리더 > 부리더 > (나머지) 등급 지정 순서 > 이름 오름차순   — 등급 없음은 맨 뒤
-- 118 과 같은 다섯 함수: crew_roster · crew_manage_roster(가입 대기는 계속 맨 위)
--   · crew_event_attendance · mcp_crew_members · mcp_event_attendance
-- 정렬만 바뀌고 반환 모양은 그대로 — 배포 순서 무관. 지우는 문장 없음.
-- 되돌리기: 118 의 같은 함수 정의를 다시 적용.
-- ============================================================

create or replace function public.crew_roster(p_slug text, p_limit integer default 100)
returns table(user_id uuid, display_name text, email text, division text, role text,
              joined_at timestamp with time zone, session_count bigint, attend_count bigint,
              attend_paid_count bigint, tier_id uuid, tier_name text, tier_color text, instagram text)
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
         t.id, t.name, t.color,
         nullif(p.instagram, '')
  from crew_members m
  join crews c on c.id = m.crew_id
  join profiles p on p.id = m.user_id
  left join auth.users u on u.id = m.user_id
  left join crew_member_tiers t on t.id = m.tier_id
  where c.slug = p_slug and m.status = 'active'
    and (select auth.uid()) is not null
    and (c.is_public or (select is_crew_member(c.id)))
  order by array_position(array['owner', 'coach'], m.role), coalesce(t.sort_order, 2147483647), t.created_at, t.id,
           lower(coalesce(p.display_name, 'Athlete')), m.joined_at
  limit least(p_limit, 500);
$$;

create or replace function public.crew_manage_roster(p_slug text)
returns table(user_id uuid, display_name text, email text, role text, status text,
              joined_at timestamp with time zone, tier_id uuid, tier_name text, tier_color text,
              attend_count bigint, attend_paid_count bigint)
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
  -- 가입 대기는 승인할 대상이라 계속 맨 위. 그 아래는 리더 > 부리더 > 등급 > 이름
  order by case m.status when 'pending' then 0 else 1 end,
           array_position(array['owner', 'coach'], m.role), coalesce(t.sort_order, 2147483647), t.created_at, t.id,
           lower(coalesce(p.display_name, 'Athlete')), m.joined_at;
$$;

create or replace function public.crew_event_attendance(p_event uuid)
returns table(user_id uuid, display_name text, email text, role text, rsvp_status text,
              checked_in boolean, charge_id uuid, charge_amount integer, charge_status text, instagram text)
language sql stable security definer set search_path to 'public' as $$
  select m.user_id,
         coalesce(p.display_name, 'Athlete'),
         case when (select is_crew_staff(e.crew_id)) or (select is_admin())
              then u.email::text else null end,
         m.role,
         r.status,
         r.checked_in_at is not null,
         case when (select is_crew_staff(e.crew_id)) or (select is_admin())
              then ch.id end,
         case when (select is_crew_staff(e.crew_id)) or (select is_admin())
              then ch.amount end,
         case when (select is_crew_staff(e.crew_id)) or (select is_admin())
              then ch.status end,
         nullif(p.instagram, '')
  from crew_events e
  join crew_members m on m.crew_id = e.crew_id and m.status = 'active'
  join profiles p on p.id = m.user_id
  left join auth.users u on u.id = m.user_id
  left join crew_member_tiers t on t.id = m.tier_id
  left join crew_event_rsvps r on r.event_id = e.id and r.user_id = m.user_id
  left join crew_dues_charges ch on ch.event_id = e.id and ch.user_id = m.user_id
                                and ch.kind = 'session'
  where e.id = p_event
    and e.cancelled_at is null
    and ((select is_crew_member(e.crew_id)) or (select is_admin()))
  -- 화면이 참석 상태별 탭으로 나누므로 서버 순서는 리더 > 부리더 > 등급 > 이름만
  order by array_position(array['owner', 'coach'], m.role), coalesce(t.sort_order, 2147483647), t.created_at, t.id,
           lower(coalesce(p.display_name, 'Athlete'));
$$;

create or replace function public.mcp_crew_members(p_token text, p_slug text)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_crew uuid := mcp_member_crew(p_token, p_slug);
  v_staff boolean := mcp_staff_crew_ro(p_token, p_slug) is not null;
begin
  if v_crew is null then return null; end if;
  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg((jsonb_build_object(
          'name', coalesce(pr.display_name, 'Athlete'),
          'role', m.role, 'tier', t.name, 'joined_at', m.joined_at)
        || case when v_staff
             then jsonb_build_object('user_id', m.user_id) else '{}'::jsonb end)
        order by array_position(array['owner', 'coach'], m.role), coalesce(t.sort_order, 2147483647), t.created_at, t.id,
                 lower(coalesce(pr.display_name, 'Athlete')))
      from crew_members m join profiles pr on pr.id = m.user_id
      left join crew_member_tiers t on t.id = m.tier_id
      where m.crew_id = v_crew and m.status = 'active'), '[]'::jsonb),
    'pending', case when v_staff then coalesce((
      select jsonb_agg(jsonb_build_object(
          'user_id', m.user_id,
          'name', coalesce(pr.display_name, 'Athlete'),
          'requested_at', m.joined_at) order by m.joined_at)
      from crew_members m join profiles pr on pr.id = m.user_id
      where m.crew_id = v_crew and m.status = 'pending'), '[]'::jsonb)
      else null end);
end; $$;

create or replace function public.mcp_event_attendance(p_token text, p_slug text, p_event uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid := mcp_staff_crew_ro(p_token, p_slug); v_ev record;
begin
  if v_crew is null then return null; end if;
  select id, title, starts_at, fee_exempt, members_only, closed_at
    into v_ev from crew_events
   where id = p_event and crew_id = v_crew and cancelled_at is null;
  if v_ev.id is null then return jsonb_build_object('error', 'event_not_found'); end if;
  return jsonb_build_object(
    'event_id', v_ev.id, 'title', v_ev.title, 'starts_at', v_ev.starts_at,
    'fee_exempt', v_ev.fee_exempt, 'members_only', v_ev.members_only,
    'closed', v_ev.closed_at is not null,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id, 'name', coalesce(p.display_name, 'Athlete'),
        'tier', t.name, 'rsvp', r.status,
        'checked_in', r.checked_in_at is not null,
        'charge_id', ch.id, 'fee', ch.amount, 'fee_status', ch.status)
        order by array_position(array['owner', 'coach'], m.role), coalesce(t.sort_order, 2147483647), t.created_at, t.id,
                 lower(coalesce(p.display_name, 'Athlete')))
      from crew_members m
      join profiles p on p.id = m.user_id
      left join crew_member_tiers t on t.id = m.tier_id
      left join crew_event_rsvps r on r.event_id = p_event and r.user_id = m.user_id
      left join crew_dues_charges ch on ch.event_id = p_event and ch.user_id = m.user_id
                                    and ch.kind = 'session'
      where m.crew_id = v_crew and m.status = 'active'), '[]'::jsonb));
end; $$;

-- ---------- 가드 -----------------------------------------------------------------
-- 운영진이 있는 크루의 명단이 리더 > 부리더 > 등급 > 이름 순인지 확인한 뒤 되감는다.
do $$
declare
  v_slug text; v_owner uuid; r record;
  v_prev_rk int; v_prev_so int; v_prev_nm text;
begin
  select c.slug, m.user_id into v_slug, v_owner
    from crews c join crew_members m on m.crew_id = c.id and m.role = 'owner' and m.status = 'active'
   order by (select count(*) from crew_members x where x.crew_id = c.id and x.status = 'active') desc
   limit 1;
  if v_slug is null then raise notice '가드 건너뜀: 크루장 있는 크루 없음'; return; end if;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
    for r in select coalesce(array_position(array['owner', 'coach'], x.role), 3) rk,
                    coalesce(t.sort_order, 2147483647) so, lower(x.display_name) nm
               from crew_roster(v_slug, 500) x left join crew_member_tiers t on t.id = x.tier_id loop
      if v_prev_rk is not null and (r.rk, r.so, r.nm) < (v_prev_rk, v_prev_so, v_prev_nm) then
        raise exception '가드: 명단 정렬이 리더>부리더>등급>이름이 아님 (% % % 다음 % % %)',
          v_prev_rk, v_prev_so, v_prev_nm, r.rk, r.so, r.nm;
      end if;
      v_prev_rk := r.rk; v_prev_so := r.so; v_prev_nm := r.nm;
    end loop;
    if v_prev_rk is null then raise exception '가드: 명단이 비어 있음'; end if;
    perform set_config('request.jwt.claims', null, true);
    raise exception 'guard_ok';
  exception when raise_exception then
    perform set_config('request.jwt.claims', null, true);
    if sqlerrm <> 'guard_ok' then raise; end if;
  end;
end $$;
