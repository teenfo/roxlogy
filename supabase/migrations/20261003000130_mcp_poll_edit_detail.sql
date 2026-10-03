-- ============================================================
-- Roxlogy — MCP 투표: 수정 · 결과 상세 (2026-10-03)
--
-- 마이그레이션 116 의 MCP 투표 도구(목록·만들기·투표·마감·지우기)에 빠져 있던 두 가지:
--   1) 수정 — _crew_poll_update_u(내부) + mcp_poll_update
--      만든 사람·운영진만. 바꿀 수 있는 것:
--        질문(1~200자) · 마감 시각(미래로 지정 / 지우기) · 복수 선택 여부
--        선택지 이름 고치기(표가 하나도 없는 선택지만 — 표의 뜻이 바뀌면 안 된다)
--        선택지 추가(빈 칸·중복 정리, 합계 10개까지)
--      익명 여부는 바꾸지 않는다(만들 때 약속). 복수→단일은 두 개 이상 고른 사람이 없을 때만.
--      한 번의 호출은 전부 되거나 전부 안 된다(오류면 앞서 바꾼 것도 되돌린다).
--   2) 결과 상세 — mcp_poll_get
--      116 의 투표 JSON + 붙은 대상(target) · 총 표 수 · 선택지별 득표율(참여자 대비)·선두 표시,
--      익명이 아니면 사람별 선택(ballots), 만든 사람·운영진에게는 아직 안 한 크루원(non_voters,
--      익명 투표에서는 주지 않는다 — 누가 했는지가 드러나므로).
-- 선택지 빼기는 행을 지워야 해서 커넥터 적용이 막힌다 — 마이그레이션 131 로 따로 둔다.
-- 신설만 — 배포 순서 무관. 되돌리기: 세 함수를 없앤다.
-- ============================================================

create or replace function public._crew_poll_update_u(
  p_uid uuid, p_poll uuid, p_question text, p_closes_at timestamptz, p_clear_closes boolean,
  p_multiple boolean, p_add text[], p_rename jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  pl record; f record; v_q text; r jsonb; v_id uuid; v_label text; x text; v_sort int;
  v_added text[] := '{}';
begin
  select * into pl from crew_polls where id = p_poll;
  if pl.id is null then return jsonb_build_object('error', 'not_found'); end if;
  select * into f from _crew_poll_flags(p_uid, pl.crew_id);
  if not (pl.created_by = p_uid or f.staff or f.admin) then
    return jsonb_build_object('error', 'not_allowed');
  end if;

  -- 오류면 이 블록 안에서 바꾼 것이 전부 되돌아간다(서브트랜잭션)
  begin
    if p_question is not null then
      v_q := btrim(p_question);
      if char_length(v_q) < 1 or char_length(v_q) > 200 then raise exception 'invalid_question'; end if;
      update crew_polls set question = v_q where id = p_poll;
    end if;

    if coalesce(p_clear_closes, false) then
      update crew_polls set closes_at = null where id = p_poll;
    elsif p_closes_at is not null then
      if p_closes_at <= now() then raise exception 'invalid_deadline'; end if;
      update crew_polls set closes_at = p_closes_at where id = p_poll;
    end if;

    if p_multiple is not null and p_multiple <> pl.multiple then
      if not p_multiple and exists (select 1 from crew_poll_votes v where v.poll_id = p_poll
                                     group by v.user_id having count(*) > 1) then
        raise exception 'multiple_votes_exist';
      end if;
      update crew_polls set multiple = p_multiple where id = p_poll;
    end if;

    for r in select * from jsonb_array_elements(coalesce(p_rename, '[]'::jsonb)) loop
      v_id := (r->>'id')::uuid;
      v_label := btrim(coalesce(r->>'label', ''));
      if v_id is null or not exists (select 1 from crew_poll_options o where o.id = v_id and o.poll_id = p_poll) then
        raise exception 'invalid_option';
      end if;
      if char_length(v_label) < 1 or char_length(v_label) > 80 then raise exception 'invalid_label'; end if;
      if (select o.label from crew_poll_options o where o.id = v_id) <> v_label then
        if exists (select 1 from crew_poll_votes v where v.option_id = v_id) then
          raise exception 'option_has_votes';
        end if;
        if exists (select 1 from crew_poll_options o where o.poll_id = p_poll and o.id <> v_id and o.label = v_label) then
          raise exception 'duplicate_option';
        end if;
        update crew_poll_options set label = v_label where id = v_id;
      end if;
    end loop;

    select coalesce(max(o.sort), 0) into v_sort from crew_poll_options o where o.poll_id = p_poll;
    foreach x in array coalesce(p_add, '{}'::text[]) loop
      x := btrim(coalesce(x, ''));
      continue when x = '' or x = any(v_added);   -- 같은 호출 안의 중복은 하나로
      if char_length(x) > 80 then raise exception 'invalid_label'; end if;
      if exists (select 1 from crew_poll_options o where o.poll_id = p_poll and o.label = x) then
        raise exception 'duplicate_option';
      end if;
      v_sort := v_sort + 1;
      insert into crew_poll_options (poll_id, label, sort) values (p_poll, x, v_sort);
      v_added := v_added || x;
    end loop;
    if (select count(*) from crew_poll_options o where o.poll_id = p_poll) > 10 then
      raise exception 'too_many_options';
    end if;
  exception
    when raise_exception then return jsonb_build_object('error', sqlerrm);
    when invalid_text_representation then return jsonb_build_object('error', 'invalid_option');
  end;
  return _crew_poll_json_u(p_poll, p_uid);
end; $$;
revoke all on function public._crew_poll_update_u(uuid, uuid, text, timestamptz, boolean, boolean, text[], jsonb)
  from public, anon, authenticated;

create or replace function public.mcp_poll_update(
  p_token text, p_poll uuid, p_question text default null, p_closes_at timestamptz default null,
  p_clear_closes boolean default false, p_multiple boolean default null,
  p_add text[] default null, p_rename jsonb default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := mcp_uid(p_token);
begin
  if v_uid is null then return null; end if;
  if not mcp_can_write(p_token) then return jsonb_build_object('error', 'read_only_token'); end if;
  return _crew_poll_update_u(v_uid, p_poll, p_question, p_closes_at, p_clear_closes,
                             p_multiple, p_add, p_rename);
end; $$;
grant execute on function public.mcp_poll_update(text, uuid, text, timestamptz, boolean, boolean, text[], jsonb)
  to anon, authenticated;

-- ---------- 결과 상세 -------------------------------------------------------------
create or replace function public.mcp_poll_get(p_token text, p_poll uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_uid uuid := mcp_uid(p_token); pl record; t record; f record;
  j jsonb; v_voters int; v_max int; v_manage boolean; v_mo boolean;
begin
  if v_uid is null then return null; end if;
  select * into pl from crew_polls where id = p_poll;
  if pl.id is null then return null; end if;
  select * into t from _crew_poll_target_u(v_uid, pl.event_id, pl.post_id);
  if t.crew_id is null or not t.visible then return null; end if;
  select * into f from _crew_poll_flags(v_uid, pl.crew_id);
  v_manage := pl.created_by = v_uid or f.staff or f.admin;
  v_mo := coalesce((select e.members_only from crew_events e where e.id = pl.event_id),
                   (select p.members_only from crew_posts p where p.id = pl.post_id), false);

  j := _crew_poll_json_u(p_poll, v_uid);
  v_voters := (j->>'voters')::int;
  select max((o->>'votes')::int) into v_max from jsonb_array_elements(j->'options') o;

  return j || jsonb_build_object(
    'target', case when pl.event_id is not null
      then (select jsonb_build_object('type', 'meetup', 'id', e.id, 'title', e.title, 'starts_at', e.starts_at)
              from crew_events e where e.id = pl.event_id)
      else (select jsonb_build_object('type', 'post', 'id', p.id, 'title', p.title)
              from crew_posts p where p.id = pl.post_id) end,
    'total_votes', (select count(*) from crew_poll_votes v where v.poll_id = p_poll),
    'results', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o->'id', 'label', o->'label', 'votes', o->'votes',
               'percent', case when v_voters > 0 then round(100.0 * (o->>'votes')::int / v_voters, 1) else 0 end,
               'leading', v_max > 0 and (o->>'votes')::int = v_max))
        from jsonb_array_elements(j->'options') o), '[]'::jsonb),
    'ballots', case when pl.anonymous then null else coalesce((
      select jsonb_agg(jsonb_build_object('user_id', b.user_id, 'name', b.name,
                                          'options', b.labels, 'voted_at', b.at) order by b.at)
        from (select v.user_id, coalesce(nullif(p.display_name, ''), 'Athlete') as name,
                     jsonb_agg(o.label order by o.sort) as labels, max(v.created_at) as at
                from crew_poll_votes v
                join crew_poll_options o on o.id = v.option_id
                join profiles p on p.id = v.user_id
               where v.poll_id = p_poll
               group by v.user_id, p.display_name) b), '[]'::jsonb) end,
    'non_voters', case when pl.anonymous or not v_manage then null else coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id,
                                          'name', coalesce(nullif(p.display_name, ''), 'Athlete'))
                       order by p.display_name)
        from crew_members m
        join profiles p on p.id = m.user_id
        left join crew_member_tiers tt on tt.id = m.tier_id
       where m.crew_id = pl.crew_id and m.status = 'active'
         and (not v_mo or m.role in ('owner', 'coach') or coalesce(tt.is_full_member, m.role <> 'associate'))
         and not exists (select 1 from crew_poll_votes v where v.poll_id = p_poll and v.user_id = m.user_id)),
      '[]'::jsonb) end);
end; $$;
grant execute on function public.mcp_poll_get(text, uuid) to anon, authenticated;

-- ---------- 가드 -----------------------------------------------------------------
-- 임시 토큰으로 MCP 경로를 돌려 본 뒤 예외로 되감는다(운영 데이터 무변경).
do $$
declare
  v_crew uuid; v_staff uuid; v_member uuid; v_event uuid; j jsonb; v_poll uuid; o1 uuid; o2 uuid;
  k_staff text := 'guard-poll-edit-staff-token-00000000001';
  k_member text := 'guard-poll-edit-member-token-0000000002';
begin
  if has_function_privilege('anon', 'public._crew_poll_update_u(uuid, uuid, text, timestamptz, boolean, boolean, text[], jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public._crew_poll_update_u(uuid, uuid, text, timestamptz, boolean, boolean, text[], jsonb)', 'execute') then
    raise exception '가드: 투표 수정 본체가 클라이언트에 열려 있습니다';
  end if;
  if not has_function_privilege('anon', 'public.mcp_poll_update(text, uuid, text, timestamptz, boolean, boolean, text[], jsonb)', 'execute')
     or not has_function_privilege('anon', 'public.mcp_poll_get(text, uuid)', 'execute') then
    raise exception '가드: MCP 투표 수정·상세에 실행 권한이 없습니다';
  end if;

  select m.crew_id, m.user_id into v_crew, v_staff
    from crew_members m join crews c on c.id = m.crew_id and c.status = 'active'
    join profiles pr on pr.id = m.user_id and not pr.disabled
   where m.status = 'active' and m.role in ('owner', 'coach') limit 1;
  if v_crew is null then raise notice '가드 건너뜀: 운영진 없음'; return; end if;
  select m.user_id into v_member from crew_members m
    join profiles pr on pr.id = m.user_id and not pr.disabled and not coalesce(pr.is_admin, false)
   where m.crew_id = v_crew and m.status = 'active' and m.role not in ('owner', 'coach')
     and m.user_id <> v_staff limit 1;

  begin
    insert into crew_events (crew_id, title, starts_at, created_by)
    values (v_crew, '가드 투표 수정 모임', now() + interval '3 days', v_staff) returning id into v_event;
    perform set_config('rox.profile_bypass', '1', true);
    update profiles set mcp_token = k_staff, mcp_write = true where id = v_staff;

    j := mcp_poll_create(k_staff, v_event, null, '뒤풀이?', array['고기', '치킨'], false, false, null);
    if j ? 'error' then raise exception '가드: 만들기 %', j; end if;
    v_poll := (j->>'id')::uuid;
    o1 := (j->'options'->0->>'id')::uuid; o2 := (j->'options'->1->>'id')::uuid;
    j := mcp_poll_vote(k_staff, v_poll, array[o1]);

    -- 상세: 대상·득표율·사람별 선택·안 한 사람
    j := mcp_poll_get(k_staff, v_poll);
    if j->'target'->>'type' <> 'meetup' or (j->'results'->0->>'percent')::numeric <> 100
       or (j->'results'->0->>'leading')::boolean is not true
       or jsonb_array_length(j->'ballots') <> 1 or jsonb_typeof(j->'non_voters') <> 'array' then
      raise exception '가드: 상세 %', j;
    end if;
    if exists (select 1 from jsonb_array_elements(j->'non_voters') x where x->>'user_id' = v_staff::text) then
      raise exception '가드: 투표한 사람이 non_voters 에 있음';
    end if;

    -- 표가 있는 선택지 이름은 못 고치고, 없는 선택지는 고친다
    j := mcp_poll_update(k_staff, v_poll, p_rename => jsonb_build_array(jsonb_build_object('id', o1, 'label', '소고기')));
    if j->>'error' is distinct from 'option_has_votes' then raise exception '가드: 표 있는 선택지 이름 바뀜 %', j; end if;
    j := mcp_poll_update(k_staff, v_poll, p_question => '뒤풀이 메뉴?',
                         p_rename => jsonb_build_array(jsonb_build_object('id', o2, 'label', '닭갈비')),
                         p_add => array['피자', '피자', ' ']);
    if j ? 'error' or j->>'question' <> '뒤풀이 메뉴?' or jsonb_array_length(j->'options') <> 3
       or j->'options'->1->>'label' <> '닭갈비' or j->'options'->2->>'label' <> '피자' then
      raise exception '가드: 수정 %', j;
    end if;
    -- 중간에 오류가 나면 앞의 변경(질문)도 되돌아간다
    j := mcp_poll_update(k_staff, v_poll, p_question => '바뀌면 안 됨', p_add => array['닭갈비']);
    if j->>'error' is distinct from 'duplicate_option'
       or (select question from crew_polls where id = v_poll) <> '뒤풀이 메뉴?' then
      raise exception '가드: 원자성 %', j;
    end if;
    j := mcp_poll_update(k_staff, v_poll, p_add => array['a','b','c','d','e','f','g','h']);
    if j->>'error' is distinct from 'too_many_options' then raise exception '가드: 10개 제한 %', j; end if;
    j := mcp_poll_update(k_staff, v_poll, p_closes_at => now() - interval '1 hour');
    if j->>'error' is distinct from 'invalid_deadline' then raise exception '가드: 지난 마감 %', j; end if;
    j := mcp_poll_update(k_staff, v_poll, p_closes_at => now() + interval '1 day');
    if j->>'closes_at' is null then raise exception '가드: 마감 지정 %', j; end if;
    j := mcp_poll_update(k_staff, v_poll, p_clear_closes => true);
    if j->>'closes_at' is not null then raise exception '가드: 마감 지우기 %', j; end if;

    -- 복수 선택 → 두 개 고른 사람이 있으면 단일로 못 돌린다
    j := mcp_poll_update(k_staff, v_poll, p_multiple => true);
    j := mcp_poll_vote(k_staff, v_poll, array[o1, o2]);
    j := mcp_poll_update(k_staff, v_poll, p_multiple => false);
    if j->>'error' is distinct from 'multiple_votes_exist' then raise exception '가드: 복수→단일 %', j; end if;

    -- 일반 크루원은 수정 못 함 · 읽기 전용 토큰은 read_only_token
    if v_member is not null then
      update profiles set mcp_token = k_member, mcp_write = true where id = v_member;
      j := mcp_poll_update(k_member, v_poll, p_question => 'x');
      if j->>'error' is distinct from 'not_allowed' then raise exception '가드: 크루원이 수정 %', j; end if;
      j := mcp_poll_get(k_member, v_poll);
      if j->'non_voters' <> 'null'::jsonb then raise exception '가드: 크루원에게 non_voters 가 나감'; end if;
    end if;
    update profiles set mcp_write = false where id = v_staff;
    j := mcp_poll_update(k_staff, v_poll, p_question => 'x');
    if j->>'error' is distinct from 'read_only_token' then raise exception '가드: 읽기 전용 수정 %', j; end if;

    -- 익명이면 ballots·non_voters 를 주지 않는다
    update crew_polls set anonymous = true where id = v_poll;
    j := mcp_poll_get(k_staff, v_poll);
    if j->'ballots' <> 'null'::jsonb or j->'non_voters' <> 'null'::jsonb then
      raise exception '가드: 익명인데 명단이 나감 %', j;
    end if;

    perform set_config('rox.profile_bypass', '', true);
    raise exception 'guard_ok';
  exception when raise_exception then
    perform set_config('rox.profile_bypass', '', true);
    if sqlerrm <> 'guard_ok' then raise; end if;
  end;
end $$;
