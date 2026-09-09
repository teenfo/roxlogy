-- ============================================================
-- Roxlogy — 공유 링크로 들어온 사람에게 "왜 안 보이는지" 알려준다
--
-- 증상: 크루 일정을 공유했는데 로그인 안 된 사람이 열면 page not found.
-- 원인: crew_event_detail 의 게이트가
--         (c.is_public or is_crew_member(c.id))
--         and (not e.members_only or is_crew_full_member(e.crew_id))
--       라서, 정회원 전용 모임은 익명에게 0행이고 페이지가 notFound() 로 떨어졌다.
--       (일반 모임은 익명에게도 정상적으로 보인다 — 정회원 전용만 막혔다)
--
-- 그냥 "안 보이면 로그인으로 보내기" 로 처리하면, 없는 모임 링크를 받은 사람은
-- 로그인까지 시킨 뒤 다시 404 를 보게 된다. 그래서 사유를 구분해 돌려준다:
--   null            → 없는 모임 / 비공개 크루  (진짜 404, 존재 여부를 흘리지 않는다)
--   visible=false + logged_in=false → 로그인하면 될 수도 있다 (로그인 후 원래 링크로)
--   visible=false + logged_in=true  → 정회원이 아니다 (로그인시켜도 소용없음 → 안내)
--
-- 안 보이는 모임의 제목은 null 로 지운다 — 게이트가 내용을 흘리면 안 된다.
-- ============================================================

create or replace function public.crew_event_gate(p_event uuid)
returns jsonb
language sql stable security definer set search_path to 'public' as $fn$
  select jsonb_build_object(
    'slug', c.slug,
    'crew', c.name,
    'title', case when (not e.members_only or is_crew_full_member(e.crew_id))
                  then e.title else null end,
    'members_only', e.members_only,
    'visible', (not e.members_only or is_crew_full_member(e.crew_id)),
    'is_member', is_crew_member(c.id),
    'logged_in', (select auth.uid()) is not null)
  from crew_events e
  join crews c on c.id = e.crew_id
  where e.id = p_event
    and e.cancelled_at is null
    and (c.is_public or is_crew_member(c.id));
$fn$;

grant execute on function public.crew_event_gate(uuid) to anon, authenticated;

-- 가드 ------------------------------------------------------------------------
do $guard$
declare
  v_pub uuid; v_mo uuid; v_gone uuid := gen_random_uuid();
  v_g jsonb; v_uid uuid;
begin
  select e.id into v_pub from crew_events e join crews c on c.id = e.crew_id
   where c.is_public and not e.members_only and e.cancelled_at is null limit 1;
  select e.id into v_mo from crew_events e join crews c on c.id = e.crew_id
   where c.is_public and e.members_only and e.cancelled_at is null limit 1;
  if v_pub is null or v_mo is null then return; end if;

  -- 익명 시점
  perform set_config('request.jwt.claims', '', true);

  v_g := public.crew_event_gate(v_pub);
  if v_g is null or (v_g->>'visible')::boolean is not true then
    raise exception '가드: 공개 모임이 익명에게 안 보입니다 (%)', v_g::text;
  end if;
  if (v_g->>'logged_in')::boolean then
    raise exception '가드: 익명인데 logged_in 이 true 입니다';
  end if;

  v_g := public.crew_event_gate(v_mo);
  if v_g is null then
    raise exception '가드: 정회원 전용 모임이 아예 null 이라 404 로 떨어집니다';
  end if;
  if (v_g->>'visible')::boolean is not false then
    raise exception '가드: 정회원 전용 모임이 익명에게 보입니다';
  end if;
  if v_g->>'title' is not null then
    raise exception '가드: 안 보이는 모임의 제목이 새어 나갑니다';
  end if;
  if v_g->>'slug' is null then
    raise exception '가드: slug 가 없어 로그인 후 돌아갈 곳을 못 만듭니다';
  end if;

  -- 없는 이벤트는 진짜 404
  if public.crew_event_gate(v_gone) is not null then
    raise exception '가드: 없는 이벤트가 null 이 아닙니다';
  end if;

  -- 정회원(=크루 소유자)으로 보면 보여야 한다
  select m.user_id into v_uid from crew_members m
   join crew_events e on e.crew_id = m.crew_id
   where e.id = v_mo and m.status = 'active' and m.role = 'owner' limit 1;
  if v_uid is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);
    v_g := public.crew_event_gate(v_mo);
    if (v_g->>'visible')::boolean is not true then
      raise exception '가드: 정회원에게도 안 보입니다 (%)', v_g::text;
    end if;
    if v_g->>'title' is null then
      raise exception '가드: 정회원인데 제목이 비었습니다';
    end if;
  end if;
end $guard$;
