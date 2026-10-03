-- ============================================================
-- Roxlogy — MCP 투표: 선택지 빼기 (2026-10-03)
--
-- 마이그레이션 130(수정·상세)과 짝. 행을 지우는 함수라 Supabase MCP 커넥터로는 적용이
-- 취소되어(CLAUDE.md "운영 DB 적용 경로") SQL Editor 에서 실행한다.
--   _crew_poll_remove_options_u(uid, poll, options[]) — 내부(grant 없음)
--   mcp_poll_remove_options(token, poll, options[])   — 쓰기 토큰 + 만든 사람·운영진
-- 규칙: 그 투표의 선택지만, 남는 선택지가 2개 이상일 때만(too_few_options).
-- 뺀 선택지에 들어간 표도 함께 사라진다(FK cascade) — 도구 설명에서 확인받게 한다.
-- 남은 선택지의 순서(sort)는 그대로 둔다(빈 번호가 있어도 정렬은 유지된다).
-- 신설만 — 배포 순서 무관. 되돌리기: 두 함수를 없앤다.
-- ============================================================

create or replace function public._crew_poll_remove_options_u(p_uid uuid, p_poll uuid, p_options uuid[])
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare pl record; f record; n_ask int; n_hit int; n_left int; n_lost int;
begin
  select * into pl from crew_polls where id = p_poll;
  if pl.id is null then return jsonb_build_object('error', 'not_found'); end if;
  select * into f from _crew_poll_flags(p_uid, pl.crew_id);
  if not (pl.created_by = p_uid or f.staff or f.admin) then
    return jsonb_build_object('error', 'not_allowed');
  end if;
  n_ask := (select count(distinct x) from unnest(coalesce(p_options, '{}'::uuid[])) x);
  if n_ask = 0 then return jsonb_build_object('error', 'no_options'); end if;
  n_hit := (select count(*) from crew_poll_options o where o.poll_id = p_poll and o.id = any(p_options));
  if n_hit <> n_ask then return jsonb_build_object('error', 'invalid_option'); end if;
  n_left := (select count(*) from crew_poll_options o where o.poll_id = p_poll) - n_hit;
  if n_left < 2 then return jsonb_build_object('error', 'too_few_options'); end if;
  n_lost := (select count(*) from crew_poll_votes v where v.poll_id = p_poll and v.option_id = any(p_options));
  delete from crew_poll_options where poll_id = p_poll and id = any(p_options);
  return _crew_poll_json_u(p_poll, p_uid) || jsonb_build_object('removed', n_hit, 'votes_removed', n_lost);
end; $$;
revoke all on function public._crew_poll_remove_options_u(uuid, uuid, uuid[]) from public, anon, authenticated;

create or replace function public.mcp_poll_remove_options(p_token text, p_poll uuid, p_options uuid[])
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := mcp_uid(p_token);
begin
  if v_uid is null then return null; end if;
  if not mcp_can_write(p_token) then return jsonb_build_object('error', 'read_only_token'); end if;
  return _crew_poll_remove_options_u(v_uid, p_poll, p_options);
end; $$;
grant execute on function public.mcp_poll_remove_options(text, uuid, uuid[]) to anon, authenticated;

-- ---------- 가드 -----------------------------------------------------------------
do $$
declare
  v_crew uuid; v_staff uuid; v_event uuid; j jsonb; v_poll uuid; o1 uuid; o2 uuid; o3 uuid;
  k_staff text := 'guard-poll-remove-staff-token-000000001';
begin
  if has_function_privilege('anon', 'public._crew_poll_remove_options_u(uuid, uuid, uuid[])', 'execute')
     or has_function_privilege('authenticated', 'public._crew_poll_remove_options_u(uuid, uuid, uuid[])', 'execute') then
    raise exception '가드: 선택지 빼기 본체가 클라이언트에 열려 있습니다';
  end if;
  select m.crew_id, m.user_id into v_crew, v_staff
    from crew_members m join crews c on c.id = m.crew_id and c.status = 'active'
    join profiles pr on pr.id = m.user_id and not pr.disabled
   where m.status = 'active' and m.role in ('owner', 'coach') limit 1;
  if v_crew is null then raise notice '가드 건너뜀: 운영진 없음'; return; end if;

  begin
    insert into crew_events (crew_id, title, starts_at, created_by)
    values (v_crew, '가드 선택지 빼기 모임', now() + interval '3 days', v_staff) returning id into v_event;
    perform set_config('rox.profile_bypass', '1', true);
    update profiles set mcp_token = k_staff, mcp_write = true where id = v_staff;

    j := mcp_poll_create(k_staff, v_event, null, 'Q', array['a', 'b', 'c'], false, false, null);
    v_poll := (j->>'id')::uuid;
    o1 := (j->'options'->0->>'id')::uuid; o2 := (j->'options'->1->>'id')::uuid; o3 := (j->'options'->2->>'id')::uuid;
    j := mcp_poll_vote(k_staff, v_poll, array[o3]);

    j := mcp_poll_remove_options(k_staff, v_poll, array[o2, o3]);
    if j->>'error' is distinct from 'too_few_options' then raise exception '가드: 2개 미만 허용 %', j; end if;
    j := mcp_poll_remove_options(k_staff, v_poll, array[gen_random_uuid()]);
    if j->>'error' is distinct from 'invalid_option' then raise exception '가드: 남의 선택지 %', j; end if;
    j := mcp_poll_remove_options(k_staff, v_poll, array[o3]);
    if j ? 'error' or jsonb_array_length(j->'options') <> 2 or (j->>'votes_removed')::int <> 1
       or (j->>'voters')::int <> 0 then
      raise exception '가드: 선택지 빼기 %', j;
    end if;

    perform set_config('rox.profile_bypass', '', true);
    raise exception 'guard_ok';
  exception when raise_exception then
    perform set_config('rox.profile_bypass', '', true);
    if sqlerrm <> 'guard_ok' then raise; end if;
  end;
end $$;
