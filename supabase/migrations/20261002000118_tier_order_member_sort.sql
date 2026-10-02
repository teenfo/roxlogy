-- ============================================================
-- Roxlogy — 등급 순서 지정 + 회원 목록 정렬 통일 (2026-10-02)
--
-- 1) reorder_crew_tiers: 운영진이 등급 순서(sort_order)를 정한다. 관리 > 등급 표의 ▲▼.
-- 2) 회원 목록 정렬 = 등급(지정 순서) > 이름(가나다·오름차순). 사용자 지정 규칙.
--    예전에는 리더·부리더를 맨 위로 올리고(역할 우선) 같은 등급 안에서는 가입순이었고,
--    모임 출석 명단은 출석·참석 상태 > 이름이라 등급과 무관하게 섞였다.
--    바꾸는 곳: crew_roster(멤버 화면·CSV) · crew_manage_roster(관리, 가입 대기는 계속 맨 위)
--              · crew_event_attendance(모임 출석 탭 — 탭이 상태별로 나누므로 서버는 등급>이름만)
--              · mcp_crew_members(+ tier 필드 추가) · mcp_event_attendance
--    모임 상세 "참석" 칩(crew_event_detail.going)은 이미 등급 > 이름이라 그대로.
--    등급 없음은 맨 뒤. 같은 sort_order 의 등급은 만든 순서로 묶는다.
--
-- 반환 모양은 그대로(mcp_crew_members 는 tier 키 추가만) — 배포 순서 무관.
-- 되돌리기: 각 함수의 직전 정의(112·113·052·085)를 다시 적용, drop function reorder_crew_tiers.
-- ============================================================

-- ---------- 1) 등급 순서 지정 -------------------------------------------------------
-- p_ids 순서대로 sort_order = 1, 2, 3 … 를 매긴다. 다른 크루의 등급이 섞이면 거부.
create or replace function public.reorder_crew_tiers(p_crew uuid, p_ids uuid[])
returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if not ((select is_crew_staff(p_crew)) or (select is_admin())) then
    raise exception 'tier_not_staff';
  end if;
  if coalesce(cardinality(p_ids), 0) = 0
     or exists (select 1 from unnest(p_ids) x
                 where not exists (select 1 from crew_member_tiers t where t.id = x and t.crew_id = p_crew)) then
    raise exception 'tier_wrong_crew';
  end if;
  update crew_member_tiers t set sort_order = s.ord
    from unnest(p_ids) with ordinality as s(id, ord)
   where t.id = s.id and t.crew_id = p_crew;
end; $$;
grant execute on function public.reorder_crew_tiers(uuid, uuid[]) to authenticated;

-- ---------- 2) 회원 목록 정렬 -------------------------------------------------------
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
  order by coalesce(t.sort_order, 2147483647), t.created_at, t.id,
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
  -- 가입 대기는 승인할 대상이라 계속 맨 위. 그 아래는 등급 > 이름
  order by case m.status when 'pending' then 0 else 1 end,
           coalesce(t.sort_order, 2147483647), t.created_at, t.id,
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
  -- 화면이 참석 상태별 탭으로 나누므로 서버 순서는 등급 > 이름만
  order by coalesce(t.sort_order, 2147483647), t.created_at, t.id,
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
        order by coalesce(t.sort_order, 2147483647), t.created_at, t.id,
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
        order by coalesce(t.sort_order, 2147483647), t.created_at, t.id,
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
-- 순서 지정 권한·동작과 명단 정렬을 실제 크루로 확인한 뒤 되감는다(운영 데이터 무변경).
do $$
declare
  v_crew uuid; v_slug text; v_owner uuid; v_out uuid; v_ids uuid[]; v_rev uuid[];
  v_prev_so int; v_prev_nm text; r record;
begin
  if has_function_privilege('anon', 'public.reorder_crew_tiers(uuid, uuid[])', 'execute') then
    raise exception '가드: 등급 순서 지정이 익명 실행 가능합니다';
  end if;

  select c.id, c.slug, m.user_id into v_crew, v_slug, v_owner
    from crews c join crew_members m on m.crew_id = c.id and m.role = 'owner' and m.status = 'active'
   where (select count(*) from crew_member_tiers t where t.crew_id = c.id and t.archived_at is null) >= 2
   limit 1;
  if v_crew is null then raise notice '가드 건너뜀: 등급이 2개 이상인 크루 없음'; return; end if;
  select array_agg(id order by sort_order, created_at, id) into v_ids from crew_member_tiers where crew_id = v_crew;
  select array_agg(x order by o desc) into v_rev from unnest(v_ids) with ordinality u(x, o);
  select p.id into v_out from profiles p
   where not exists (select 1 from crew_members m where m.crew_id = v_crew and m.user_id = p.id)
     and not coalesce(p.is_admin, false) limit 1;

  begin
    -- 크루 밖 사람은 순서를 못 바꾼다
    if v_out is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', v_out::text, 'role', 'authenticated')::text, true);
      begin
        perform reorder_crew_tiers(v_crew, v_rev);
        raise exception '가드: 크루 밖 사람이 등급 순서를 바꿈';
      exception when raise_exception then
        if sqlerrm <> 'tier_not_staff' then raise; end if;
      end;
    end if;

    -- 크루장이 거꾸로 뒤집으면 첫 등급이 마지막 id 가 된다
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
    perform reorder_crew_tiers(v_crew, v_rev);
    if (select id from crew_member_tiers where crew_id = v_crew order by sort_order, created_at, id limit 1)
       <> v_rev[1] then
      raise exception '가드: 등급 순서가 바뀌지 않음';
    end if;

    -- 명단은 등급(지정 순서) > 이름 순이어야 한다
    for r in select coalesce(t.sort_order, 2147483647) so, lower(x.display_name) nm
               from crew_roster(v_slug, 500) x left join crew_member_tiers t on t.id = x.tier_id loop
      if v_prev_so is not null and (r.so, r.nm) < (v_prev_so, v_prev_nm) then
        raise exception '가드: 명단 정렬이 등급>이름이 아님 (% % 다음 % %)', v_prev_so, v_prev_nm, r.so, r.nm;
      end if;
      v_prev_so := r.so; v_prev_nm := r.nm;
    end loop;

    perform set_config('request.jwt.claims', null, true);
    raise exception 'guard_ok';
  exception when raise_exception then
    perform set_config('request.jwt.claims', null, true);
    if sqlerrm <> 'guard_ok' then raise; end if;
  end;
end $$;
