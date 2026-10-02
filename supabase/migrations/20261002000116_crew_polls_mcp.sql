-- ============================================================
-- Roxlogy — 크루 투표 MCP 도구 (2026-10-02)
--
-- 마이그레이션 115 의 투표 판정은 auth.uid() 를 직접 읽어서, 토큰으로 사용자를 찾는 MCP
-- 경로가 쓸 수 없었다. 판정·생성·투표 본체를 "사용자 id 를 인자로 받는" 내부 함수로 옮기고
--   - 웹 RPC(crew_poll_*)      → auth.uid() 를 넘긴다 (이름·인자·반환 모양 그대로)
--   - MCP RPC(mcp_poll_*)      → mcp_uid(토큰) 을 넘긴다 + 쓰기는 mcp_can_write 관문
-- 둘이 같은 본체를 타므로 권한 규칙이 갈라지지 않는다.
--
-- MCP 쓰기 응답 규약(mcp_rsvp 와 같음): 토큰 무효 → null, 읽기 전용 토큰 → {error:'read_only_token'}.
-- 내부 함수(_crew_poll_*)는 grant 하지 않는다. MCP RPC 는 토큰을 스스로 검증하므로 anon 에 연다
-- (다른 mcp_* 와 같음 — 서버는 anon 키만 쓴다).
--
-- 되돌리기: drop function mcp_poll_*(...); 115 의 crew_poll_*/_crew_poll_target/_crew_poll_json 재적용.
-- ============================================================

-- ---------- 내부: 사용자 한 명의 크루 내 위치 -------------------------------------
create or replace function public._crew_poll_flags(p_uid uuid, p_crew uuid)
returns table(member boolean, staff boolean, full_member boolean, admin boolean)
language sql stable security definer set search_path to 'public' as $$
  select m.user_id is not null,
         coalesce(m.role in ('owner', 'coach'), false),
         coalesce(m.role in ('owner', 'coach') or coalesce(t.is_full_member, m.role <> 'associate'), false),
         coalesce((select pr.is_admin from profiles pr where pr.id = p_uid), false)
    from (select 1) one
    left join crew_members m
      on p_uid is not null and m.crew_id = p_crew and m.user_id = p_uid and m.status = 'active'
    left join crew_member_tiers t on t.id = m.tier_id;
$$;
revoke all on function public._crew_poll_flags(uuid, uuid) from public, anon, authenticated;

-- 붙은 대상의 크루 · 볼 수 있는가 · 만들 수 있는가 (115 의 규칙을 사용자 인자로)
create or replace function public._crew_poll_target_u(p_uid uuid, p_event uuid, p_post uuid)
returns table(crew_id uuid, visible boolean, can_create boolean)
language sql stable security definer set search_path to 'public' as $$
  select e.crew_id,
         ((c.is_public or f.member) and (not e.members_only or f.full_member)) or f.admin,
         f.staff or f.admin
    from crew_events e join crews c on c.id = e.crew_id
    cross join lateral _crew_poll_flags(p_uid, c.id) f
   where p_event is not null and e.id = p_event and e.cancelled_at is null
  union all
  select p.crew_id,
         (p.deleted_at is null
           and (c.is_public or f.member)
           and (not p.members_only or p.author_id = p_uid or f.full_member))
           or f.admin,
         p.deleted_at is null and (p.author_id = p_uid or f.staff or f.admin)
    from crew_posts p join crews c on c.id = p.crew_id
    cross join lateral _crew_poll_flags(p_uid, c.id) f
   where p_post is not null and p.id = p_post;
$$;
revoke all on function public._crew_poll_target_u(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public._crew_poll_json_u(p_poll uuid, p_uid uuid)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'id', pl.id, 'question', pl.question, 'multiple', pl.multiple, 'anonymous', pl.anonymous,
    'closes_at', pl.closes_at, 'closed_at', pl.closed_at,
    'closed', pl.closed_at is not null or (pl.closes_at is not null and pl.closes_at <= now()),
    'created_by', pl.created_by,
    'created_by_name', coalesce(nullif(cp.display_name, ''), 'Athlete'),
    'created_at', pl.created_at,
    'can_manage', p_uid is not null and (pl.created_by = p_uid or f.staff or f.admin),
    'can_vote', f.member,
    'voters', (select count(distinct v.user_id) from crew_poll_votes v where v.poll_id = pl.id),
    'my_votes', coalesce((select jsonb_agg(v.option_id) from crew_poll_votes v
                           where v.poll_id = pl.id and v.user_id = p_uid), '[]'::jsonb),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id, 'label', o.label,
               'votes', (select count(*) from crew_poll_votes v where v.option_id = o.id),
               -- 익명이면 누가 골랐는지는 내리지 않는다
               'names', case when pl.anonymous then '[]'::jsonb else coalesce((
                          select jsonb_agg(coalesce(nullif(p.display_name, ''), 'Athlete') order by v.created_at)
                            from crew_poll_votes v join profiles p on p.id = v.user_id
                           where v.option_id = o.id), '[]'::jsonb) end)
             order by o.sort)
        from crew_poll_options o where o.poll_id = pl.id), '[]'::jsonb))
  from crew_polls pl
  left join profiles cp on cp.id = pl.created_by
  cross join lateral _crew_poll_flags(p_uid, pl.crew_id) f
  where pl.id = p_poll;
$$;
revoke all on function public._crew_poll_json_u(uuid, uuid) from public, anon, authenticated;

-- ---------- 내부 본체 ---------------------------------------------------------------
create or replace function public._crew_poll_list_u(p_uid uuid, p_event uuid, p_post uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare t record;
begin
  select * into t from _crew_poll_target_u(p_uid, p_event, p_post);
  if t.crew_id is null or not t.visible then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(_crew_poll_json_u(pl.id, p_uid) order by pl.created_at)
      from crew_polls pl
     where (p_event is not null and pl.event_id = p_event)
        or (p_post is not null and pl.post_id = p_post)), '[]'::jsonb);
end; $$;
revoke all on function public._crew_poll_list_u(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public._crew_poll_create_u(
  p_uid uuid, p_event uuid, p_post uuid, p_question text, p_options text[],
  p_multiple boolean, p_anonymous boolean, p_closes_at timestamptz)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  t record; v_id uuid; v_opts text[]; i int;
  v_q text := btrim(coalesce(p_question, ''));
begin
  if num_nonnulls(p_event, p_post) <> 1 then return jsonb_build_object('error', 'invalid_target'); end if;
  select * into t from _crew_poll_target_u(p_uid, p_event, p_post);
  if t.crew_id is null or not t.visible then return jsonb_build_object('error', 'not_found'); end if;
  if not t.can_create then return jsonb_build_object('error', 'not_allowed'); end if;
  if char_length(v_q) < 1 or char_length(v_q) > 200 then
    return jsonb_build_object('error', 'invalid_question');
  end if;
  -- 빈 선택지는 버리고, 같은 이름은 하나로
  select array_agg(l order by min_ord) into v_opts from (
    select btrim(x) as l, min(ord) as min_ord
      from unnest(coalesce(p_options, '{}')) with ordinality as u(x, ord)
     where char_length(btrim(x)) between 1 and 80
     group by btrim(x)) s;
  if coalesce(cardinality(v_opts), 0) < 2 or cardinality(v_opts) > 10 then
    return jsonb_build_object('error', 'invalid_options');
  end if;
  if p_closes_at is not null and p_closes_at <= now() then
    return jsonb_build_object('error', 'invalid_deadline');
  end if;
  insert into crew_polls (crew_id, event_id, post_id, question, multiple, anonymous, closes_at, created_by)
  values (t.crew_id, p_event, p_post, v_q, coalesce(p_multiple, false), coalesce(p_anonymous, false),
          p_closes_at, p_uid)
  returning id into v_id;
  for i in 1..cardinality(v_opts) loop
    insert into crew_poll_options (poll_id, label, sort) values (v_id, v_opts[i], i);
  end loop;
  return _crew_poll_json_u(v_id, p_uid);
end; $$;
revoke all on function public._crew_poll_create_u(uuid, uuid, uuid, text, text[], boolean, boolean, timestamptz)
  from public, anon, authenticated;

-- 내 표를 통째로 바꾼다 — 빈 배열이면 취소
create or replace function public._crew_poll_vote_u(p_uid uuid, p_poll uuid, p_options uuid[])
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare pl record; t record; n int;
begin
  select * into pl from crew_polls where id = p_poll;
  if pl.id is null then return jsonb_build_object('error', 'not_found'); end if;
  select * into t from _crew_poll_target_u(p_uid, pl.event_id, pl.post_id);
  if t.crew_id is null or not t.visible then return jsonb_build_object('error', 'not_found'); end if;
  if not (select f.member from _crew_poll_flags(p_uid, pl.crew_id) f) then
    return jsonb_build_object('error', 'not_member');
  end if;
  if pl.closed_at is not null or (pl.closes_at is not null and pl.closes_at <= now()) then
    return jsonb_build_object('error', 'poll_closed');
  end if;
  n := coalesce(cardinality(p_options), 0);
  if n > 1 and not pl.multiple then return jsonb_build_object('error', 'single_choice'); end if;
  if n > 0 and (select count(*) from crew_poll_options o
                 where o.poll_id = p_poll and o.id = any(p_options)) <> (select count(distinct x) from unnest(p_options) x) then
    return jsonb_build_object('error', 'invalid_options');
  end if;
  delete from crew_poll_votes where poll_id = p_poll and user_id = p_uid;
  if n > 0 then
    insert into crew_poll_votes (poll_id, option_id, user_id)
    select p_poll, x, p_uid from (select distinct x from unnest(p_options) x) s;
  end if;
  return _crew_poll_json_u(p_poll, p_uid);
end; $$;
revoke all on function public._crew_poll_vote_u(uuid, uuid, uuid[]) from public, anon, authenticated;

create or replace function public._crew_poll_set_closed_u(p_uid uuid, p_poll uuid, p_closed boolean)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare pl record; f record;
begin
  select * into pl from crew_polls where id = p_poll;
  if pl.id is null then return jsonb_build_object('error', 'not_found'); end if;
  select * into f from _crew_poll_flags(p_uid, pl.crew_id);
  if not (pl.created_by = p_uid or f.staff or f.admin) then
    return jsonb_build_object('error', 'not_allowed');
  end if;
  -- 다시 열 때 마감 시각이 이미 지났으면 마감 시각도 지운다(안 그러면 열어도 닫혀 있다)
  update crew_polls
     set closed_at = case when p_closed then now() else null end,
         closes_at = case when not p_closed and closes_at is not null and closes_at <= now()
                          then null else closes_at end
   where id = p_poll;
  return _crew_poll_json_u(p_poll, p_uid);
end; $$;
revoke all on function public._crew_poll_set_closed_u(uuid, uuid, boolean) from public, anon, authenticated;

create or replace function public._crew_poll_delete_u(p_uid uuid, p_poll uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare pl record; f record;
begin
  select * into pl from crew_polls where id = p_poll;
  if pl.id is null then return jsonb_build_object('error', 'not_found'); end if;
  select * into f from _crew_poll_flags(p_uid, pl.crew_id);
  if not (pl.created_by = p_uid or f.staff or f.admin) then
    return jsonb_build_object('error', 'not_allowed');
  end if;
  delete from crew_polls where id = p_poll;
  return jsonb_build_object('ok', true);
end; $$;
revoke all on function public._crew_poll_delete_u(uuid, uuid) from public, anon, authenticated;

-- ---------- 웹 RPC: 이름·인자·반환 그대로, 본체만 교체 --------------------------------
create or replace function public.crew_poll_list(p_event uuid default null, p_post uuid default null)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select _crew_poll_list_u(auth.uid(), p_event, p_post);
$$;
grant execute on function public.crew_poll_list(uuid, uuid) to anon, authenticated;

create or replace function public.crew_poll_create(
  p_event uuid, p_post uuid, p_question text, p_options text[],
  p_multiple boolean default false, p_anonymous boolean default false,
  p_closes_at timestamptz default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  return _crew_poll_create_u(auth.uid(), p_event, p_post, p_question, p_options,
                             p_multiple, p_anonymous, p_closes_at);
end; $$;
grant execute on function public.crew_poll_create(uuid, uuid, text, text[], boolean, boolean, timestamptz) to authenticated;

create or replace function public.crew_poll_vote(p_poll uuid, p_options uuid[])
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  return _crew_poll_vote_u(auth.uid(), p_poll, p_options);
end; $$;
grant execute on function public.crew_poll_vote(uuid, uuid[]) to authenticated;

create or replace function public.crew_poll_set_closed(p_poll uuid, p_closed boolean)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  return _crew_poll_set_closed_u(auth.uid(), p_poll, p_closed);
end; $$;
grant execute on function public.crew_poll_set_closed(uuid, boolean) to authenticated;

create or replace function public.crew_poll_delete(p_poll uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  return _crew_poll_delete_u(auth.uid(), p_poll);
end; $$;
grant execute on function public.crew_poll_delete(uuid) to authenticated;

-- 115 의 auth.uid() 판정 헬퍼는 이제 아무도 부르지 않는다
drop function if exists public._crew_poll_target(uuid, uuid);
drop function if exists public._crew_poll_json(uuid);

-- ---------- MCP RPC ---------------------------------------------------------------
-- 목록: 모임(p_event)·게시글(p_post) 하나를 주면 그 대상의 투표, 아니면 크루(p_slug) 전체 최근 20건.
-- 크루 전체 목록은 각 투표에 붙은 대상(target: meetup/post, id, title)을 같이 준다.
create or replace function public.mcp_poll_list(
  p_token text, p_slug text default null, p_event uuid default null, p_post uuid default null,
  p_open_only boolean default false)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := mcp_uid(p_token); t record; v_crew uuid;
begin
  if v_uid is null then return null; end if;
  if p_event is not null or p_post is not null then
    if num_nonnulls(p_event, p_post) <> 1 then return jsonb_build_object('error', 'invalid_target'); end if;
    select * into t from _crew_poll_target_u(v_uid, p_event, p_post);
    if t.crew_id is null or not t.visible then return null; end if;
    return jsonb_build_object('can_create', t.can_create,
                              'polls', _crew_poll_list_u(v_uid, p_event, p_post));
  end if;
  select c.id into v_crew from crews c where c.slug = p_slug and c.status = 'active';
  if v_crew is null then return null; end if;
  return coalesce((
    select jsonb_agg(_crew_poll_json_u(pl.id, v_uid) || jsonb_build_object('target',
             case when pl.event_id is not null
                  then jsonb_build_object('type', 'meetup', 'id', e.id, 'title', e.title, 'starts_at', e.starts_at)
                  else jsonb_build_object('type', 'post', 'id', p.id, 'title', p.title) end)
           order by pl.created_at desc)
      from (select pl0.* from crew_polls pl0
             cross join lateral _crew_poll_target_u(v_uid, pl0.event_id, pl0.post_id) t0
            where pl0.crew_id = v_crew and t0.visible
              and (not coalesce(p_open_only, false)
                   or (pl0.closed_at is null and (pl0.closes_at is null or pl0.closes_at > now())))
            order by pl0.created_at desc
            limit 20) pl
      left join crew_events e on e.id = pl.event_id
      left join crew_posts p on p.id = pl.post_id), '[]'::jsonb);
end; $$;
grant execute on function public.mcp_poll_list(text, text, uuid, uuid, boolean) to anon, authenticated;

create or replace function public.mcp_poll_create(
  p_token text, p_event uuid, p_post uuid, p_question text, p_options text[],
  p_multiple boolean default false, p_anonymous boolean default false,
  p_closes_at timestamptz default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := mcp_uid(p_token);
begin
  if v_uid is null then return null; end if;
  if not mcp_can_write(p_token) then return jsonb_build_object('error', 'read_only_token'); end if;
  return _crew_poll_create_u(v_uid, p_event, p_post, p_question, p_options,
                             p_multiple, p_anonymous, p_closes_at);
end; $$;
grant execute on function public.mcp_poll_create(text, uuid, uuid, text, text[], boolean, boolean, timestamptz)
  to anon, authenticated;

create or replace function public.mcp_poll_vote(p_token text, p_poll uuid, p_options uuid[])
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := mcp_uid(p_token);
begin
  if v_uid is null then return null; end if;
  if not mcp_can_write(p_token) then return jsonb_build_object('error', 'read_only_token'); end if;
  return _crew_poll_vote_u(v_uid, p_poll, p_options);
end; $$;
grant execute on function public.mcp_poll_vote(text, uuid, uuid[]) to anon, authenticated;

create or replace function public.mcp_poll_set_closed(p_token text, p_poll uuid, p_closed boolean)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := mcp_uid(p_token);
begin
  if v_uid is null then return null; end if;
  if not mcp_can_write(p_token) then return jsonb_build_object('error', 'read_only_token'); end if;
  return _crew_poll_set_closed_u(v_uid, p_poll, p_closed);
end; $$;
grant execute on function public.mcp_poll_set_closed(text, uuid, boolean) to anon, authenticated;

create or replace function public.mcp_poll_delete(p_token text, p_poll uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := mcp_uid(p_token);
begin
  if v_uid is null then return null; end if;
  if not mcp_can_write(p_token) then return jsonb_build_object('error', 'read_only_token'); end if;
  return _crew_poll_delete_u(v_uid, p_poll);
end; $$;
grant execute on function public.mcp_poll_delete(text, uuid) to anon, authenticated;

-- ---------- 가드 -----------------------------------------------------------------
-- 웹 경로(jwt 가장)와 MCP 경로(임시 토큰)를 모두 돌려 본 뒤 예외로 되감는다(운영 데이터 무변경).
do $$
declare
  v_crew uuid; v_slug text; v_staff uuid; v_member uuid; v_out uuid; v_event uuid;
  j jsonb; v_poll uuid; o1 uuid; o2 uuid;
  k_staff text := 'guard-poll-staff-token-0000000000000001';
  k_member text := 'guard-poll-member-token-000000000000002';
begin
  -- 내부 함수는 어떤 클라이언트에도 열려 있으면 안 된다
  if has_function_privilege('anon', 'public._crew_poll_flags(uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._crew_poll_vote_u(uuid, uuid, uuid[])', 'execute')
     or has_function_privilege('anon', 'public._crew_poll_create_u(uuid, uuid, uuid, text, text[], boolean, boolean, timestamptz)', 'execute') then
    raise exception '가드: 내부 투표 함수가 클라이언트에 열려 있습니다';
  end if;
  if has_function_privilege('anon', 'public.crew_poll_vote(uuid, uuid[])', 'execute') then
    raise exception '가드: 웹 투표가 익명 실행 가능합니다';
  end if;
  if not has_function_privilege('anon', 'public.mcp_poll_vote(text, uuid, uuid[])', 'execute') then
    raise exception '가드: MCP 투표 RPC 에 실행 권한이 없습니다';
  end if;

  select m.crew_id, c.slug, m.user_id into v_crew, v_slug, v_staff
    from crew_members m join crews c on c.id = m.crew_id and c.status = 'active'
    join profiles pr on pr.id = m.user_id and not pr.disabled
   where m.status = 'active' and m.role in ('owner','coach') limit 1;
  if v_crew is null then raise notice '가드 건너뜀: 운영진 없음'; return; end if;
  select m.user_id into v_member from crew_members m
    join profiles pr on pr.id = m.user_id and not pr.disabled and not coalesce(pr.is_admin, false)
   where m.crew_id = v_crew and m.status = 'active' and m.role not in ('owner','coach')
     and m.user_id <> v_staff limit 1;
  select p.id into v_out from profiles p
   where not exists (select 1 from crew_members m where m.crew_id = v_crew and m.user_id = p.id)
     and not coalesce(p.is_admin, false) and not p.disabled limit 1;

  begin
    insert into crew_events (crew_id, title, starts_at, created_by)
    values (v_crew, '가드 투표 모임', now() + interval '3 days', v_staff) returning id into v_event;

    -- ── 웹 경로 (115 와 같은 동작인지) ──
    perform set_config('request.jwt.claims', json_build_object('sub', v_staff::text, 'role', 'authenticated')::text, true);
    j := crew_poll_create(v_event, null, '뒤풀이 어디?', array['고기', '치킨', '고기', ''], false, false, null);
    if j ? 'error' then raise exception '가드: 웹 만들기 실패 %', j; end if;
    v_poll := (j->>'id')::uuid;
    if jsonb_array_length(j->'options') <> 2 then raise exception '가드: 선택지 정리 %', j->'options'; end if;
    o1 := (j->'options'->0->>'id')::uuid; o2 := (j->'options'->1->>'id')::uuid;
    if (j->>'can_manage')::boolean is not true then raise exception '가드: 운영진 관리 권한 %', j; end if;
    j := crew_poll_vote(v_poll, array[o1, o2]);
    if j->>'error' is distinct from 'single_choice' then raise exception '가드: 단일 선택 제한 %', j; end if;
    j := crew_poll_vote(v_poll, array[o1]);
    if (j->'options'->0->>'votes')::int <> 1 then raise exception '가드: 웹 투표 집계 %', j; end if;
    if jsonb_array_length(crew_poll_list(v_event, null)) <> 1 then raise exception '가드: 웹 목록'; end if;
    perform set_config('request.jwt.claims', null, true);

    -- ── MCP 경로 ── (임시 토큰. 토큰 잠금 트리거는 관리 경로용 우회 플래그로 넘긴다 — 전부 되감긴다)
    perform set_config('rox.profile_bypass', '1', true);
    update profiles set mcp_token = k_staff, mcp_write = true where id = v_staff;
    -- 무효 토큰 → null
    if mcp_poll_list('guard-poll-invalid-token-0000000000000', v_slug, null, null, false) is not null then
      raise exception '가드: 무효 토큰이 목록을 받음';
    end if;
    -- 크루 전체 목록에 대상 정보가 붙는다
    j := mcp_poll_list(k_staff, v_slug, null, null, false);
    if not exists (select 1 from jsonb_array_elements(j) x
                    where x->>'id' = v_poll::text and x->'target'->>'type' = 'meetup'
                      and x->'target'->>'id' = v_event::text) then
      raise exception '가드: MCP 크루 목록에 투표·대상이 없음 %', j;
    end if;
    -- 대상 지정 목록은 만들기 권한을 같이 준다
    j := mcp_poll_list(k_staff, null, v_event, null, false);
    if (j->>'can_create')::boolean is not true or jsonb_array_length(j->'polls') <> 1 then
      raise exception '가드: MCP 대상 목록 %', j;
    end if;
    -- 표 바꾸기 → 그 사람 표로 기록된다
    j := mcp_poll_vote(k_staff, v_poll, array[o2]);
    if (j->'options'->0->>'votes')::int <> 0 or (j->'options'->1->>'votes')::int <> 1
       or (j->'my_votes'->>0) is distinct from o2::text then
      raise exception '가드: MCP 표 바꾸기 %', j;
    end if;
    -- 만들기 · 마감 · 다시 열기 · 지우기
    j := mcp_poll_create(k_staff, v_event, null, 'MCP 투표', array['a','b','c'], true, true, now() + interval '1 day');
    if j ? 'error' or (j->>'multiple')::boolean is not true or (j->>'anonymous')::boolean is not true then
      raise exception '가드: MCP 만들기 %', j;
    end if;
    j := mcp_poll_set_closed(k_staff, (j->>'id')::uuid, true);
    if (j->>'closed')::boolean is not true then raise exception '가드: MCP 마감 %', j; end if;
    j := mcp_poll_vote(k_staff, (j->>'id')::uuid, array[(j->'options'->0->>'id')::uuid]);
    if j->>'error' is distinct from 'poll_closed' then raise exception '가드: 마감 후 MCP 투표 %', j; end if;
    j := mcp_poll_list(k_staff, v_slug, null, null, true);
    if exists (select 1 from jsonb_array_elements(j) x where x->>'question' = 'MCP 투표') then
      raise exception '가드: 진행 중 필터에 마감 투표가 섞임';
    end if;
    j := mcp_poll_delete(k_staff, (select id from crew_polls where question = 'MCP 투표' and event_id = v_event));
    if (j->>'ok')::boolean is not true then raise exception '가드: MCP 지우기 %', j; end if;

    -- 읽기 전용 토큰: 목록은 되고 쓰기는 read_only_token
    update profiles set mcp_write = false where id = v_staff;
    if mcp_poll_list(k_staff, null, v_event, null, false) is null then raise exception '가드: 읽기 전용 목록'; end if;
    j := mcp_poll_vote(k_staff, v_poll, array[o1]);
    if j->>'error' is distinct from 'read_only_token' then raise exception '가드: 읽기 전용 투표 %', j; end if;
    j := mcp_poll_create(k_staff, v_event, null, 'x', array['a','b'], false, false, null);
    if j->>'error' is distinct from 'read_only_token' then raise exception '가드: 읽기 전용 만들기 %', j; end if;

    -- 일반 크루원 토큰: 모임 투표 못 만들고, 투표는 하고, 마감은 못 한다
    if v_member is not null then
      update profiles set mcp_token = k_member, mcp_write = true where id = v_member;
      j := mcp_poll_create(k_member, v_event, null, 'x', array['a','b'], false, false, null);
      if j->>'error' is distinct from 'not_allowed' then raise exception '가드: 크루원이 MCP 로 모임 투표 만듦 %', j; end if;
      j := mcp_poll_vote(k_member, v_poll, array[o1]);
      if j ? 'error' or (j->>'voters')::int <> 2 then raise exception '가드: 크루원 MCP 투표 %', j; end if;
      j := mcp_poll_set_closed(k_member, v_poll, true);
      if j->>'error' is distinct from 'not_allowed' then raise exception '가드: 크루원이 MCP 로 마감 %', j; end if;
    end if;

    -- 크루 밖 사람(웹)은 투표할 수 없다
    if v_out is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', v_out::text, 'role', 'authenticated')::text, true);
      j := crew_poll_vote(v_poll, array[o1]);
      if not (j ? 'error') then raise exception '가드: 크루 밖 사람이 투표함 %', j; end if;
      perform set_config('request.jwt.claims', null, true);
    end if;

    perform set_config('rox.profile_bypass', '', true);
    raise exception 'guard_ok';
  exception when raise_exception then
    perform set_config('request.jwt.claims', null, true);
    perform set_config('rox.profile_bypass', '', true);
    if sqlerrm <> 'guard_ok' then raise; end if;
  end;
end $$;
