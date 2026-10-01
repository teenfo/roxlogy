-- ============================================================
-- Roxlogy — 크루 투표 (모임·게시글에 붙는다, 2026-10-01)
--
-- 투표 하나는 크루 모임(crew_events) 또는 게시글(crew_posts) 하나에 붙는다(둘 중 정확히 하나).
--   만들기: 모임 → 운영진(리더·부리더) / 게시글 → 글쓴이 또는 운영진
--   보기:   붙은 모임·게시글을 볼 수 있는 사람(정회원 전용 규칙을 그대로 따른다)
--   투표:   그 크루의 활동 크루원 + 위 보기 조건. 마감 전까지 바꾸거나 취소할 수 있다
--   마감:   closes_at 이 지났거나 운영진·만든 사람이 닫으면(closed_at). 다시 열 수 있다
--   결과:   투표 전에도 보인다. 익명 투표면 누가 골랐는지는 내려가지 않는다(본인 선택만)
--
-- 테이블은 RLS 를 켜고 정책을 두지 않는다 — 모든 읽기·쓰기는 아래 SECURITY DEFINER RPC 로만.
-- 클라이언트용 RPC 는 정의 직후 grant, 내부 헬퍼(_crew_poll_*)는 grant 하지 않는다(CLAUDE.md).
--
-- 되돌리기: drop function crew_poll_*(...) / _crew_poll_*(...);
--           drop table crew_poll_votes, crew_poll_options, crew_polls;
-- ============================================================

create table if not exists public.crew_polls (
  id          uuid primary key default gen_random_uuid(),
  crew_id     uuid not null references public.crews(id) on delete cascade,
  event_id    uuid references public.crew_events(id) on delete cascade,
  post_id     uuid references public.crew_posts(id) on delete cascade,
  question    text not null check (char_length(btrim(question)) between 1 and 200),
  multiple    boolean not null default false,
  anonymous   boolean not null default false,
  closes_at   timestamptz,
  closed_at   timestamptz,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint crew_polls_one_parent check (num_nonnulls(event_id, post_id) = 1)
);
create index if not exists crew_polls_event_idx on public.crew_polls(event_id) where event_id is not null;
create index if not exists crew_polls_post_idx  on public.crew_polls(post_id)  where post_id  is not null;
create index if not exists crew_polls_crew_idx  on public.crew_polls(crew_id);
create index if not exists crew_polls_created_by_idx on public.crew_polls(created_by);

create table if not exists public.crew_poll_options (
  id       uuid primary key default gen_random_uuid(),
  poll_id  uuid not null references public.crew_polls(id) on delete cascade,
  label    text not null check (char_length(btrim(label)) between 1 and 80),
  sort     smallint not null
);
create index if not exists crew_poll_options_poll_idx on public.crew_poll_options(poll_id, sort);

create table if not exists public.crew_poll_votes (
  poll_id    uuid not null references public.crew_polls(id) on delete cascade,
  option_id  uuid not null references public.crew_poll_options(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (option_id, user_id)
);
create index if not exists crew_poll_votes_poll_user_idx on public.crew_poll_votes(poll_id, user_id);
create index if not exists crew_poll_votes_user_idx on public.crew_poll_votes(user_id);

alter table public.crew_polls        enable row level security;
alter table public.crew_poll_options enable row level security;
alter table public.crew_poll_votes   enable row level security;
-- 정책 없음 = 직접 접근 차단. RPC 만 쓴다.

-- ---------- 내부: 붙은 대상의 크루와 "볼 수 있는가" ------------------------------
-- 모임: 크루 공개 또는 크루원 + 정회원 전용이면 정회원(관리자 예외)
-- 게시글: 삭제 안 됨 + 크루 공개 또는 크루원 + 정회원 전용이면 글쓴이·정회원(관리자 예외)
create or replace function public._crew_poll_target(p_event uuid, p_post uuid)
returns table(crew_id uuid, visible boolean, can_create boolean)
language sql stable security definer set search_path to 'public' as $$
  select e.crew_id,
         ((c.is_public or is_crew_member(c.id)) and (not e.members_only or is_crew_full_member(c.id)))
           or is_admin(),
         is_crew_staff(c.id) or is_admin()
    from crew_events e join crews c on c.id = e.crew_id
   where p_event is not null and e.id = p_event and e.cancelled_at is null
  union all
  select p.crew_id,
         (p.deleted_at is null
           and (c.is_public or is_crew_member(c.id))
           and (not p.members_only or p.author_id = auth.uid() or is_crew_full_member(c.id)))
           or is_admin(),
         p.deleted_at is null and (p.author_id = auth.uid() or is_crew_staff(c.id) or is_admin())
    from crew_posts p join crews c on c.id = p.crew_id
   where p_post is not null and p.id = p_post;
$$;
revoke all on function public._crew_poll_target(uuid, uuid) from public, anon, authenticated;

-- 투표 한 건의 응답 JSON
create or replace function public._crew_poll_json(p_poll uuid)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'id', pl.id, 'question', pl.question, 'multiple', pl.multiple, 'anonymous', pl.anonymous,
    'closes_at', pl.closes_at, 'closed_at', pl.closed_at,
    'closed', pl.closed_at is not null or (pl.closes_at is not null and pl.closes_at <= now()),
    'created_by', pl.created_by,
    'created_by_name', coalesce(nullif(cp.display_name, ''), 'Athlete'),
    'created_at', pl.created_at,
    'can_manage', auth.uid() is not null
                  and (pl.created_by = auth.uid() or is_crew_staff(pl.crew_id) or is_admin()),
    'can_vote', is_crew_member(pl.crew_id),
    'voters', (select count(distinct v.user_id) from crew_poll_votes v where v.poll_id = pl.id),
    'my_votes', coalesce((select jsonb_agg(v.option_id) from crew_poll_votes v
                           where v.poll_id = pl.id and v.user_id = auth.uid()), '[]'::jsonb),
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
  from crew_polls pl left join profiles cp on cp.id = pl.created_by
  where pl.id = p_poll;
$$;
revoke all on function public._crew_poll_json(uuid) from public, anon, authenticated;

-- ---------- 목록: 모임 또는 게시글에 붙은 투표 -----------------------------------
create or replace function public.crew_poll_list(p_event uuid default null, p_post uuid default null)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare t record;
begin
  select * into t from _crew_poll_target(p_event, p_post);
  if t.crew_id is null or not t.visible then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(_crew_poll_json(pl.id) order by pl.created_at)
      from crew_polls pl
     where (p_event is not null and pl.event_id = p_event)
        or (p_post is not null and pl.post_id = p_post)), '[]'::jsonb);
end; $$;
grant execute on function public.crew_poll_list(uuid, uuid) to anon, authenticated;

-- ---------- 만들기 -----------------------------------------------------------------
create or replace function public.crew_poll_create(
  p_event uuid, p_post uuid, p_question text, p_options text[],
  p_multiple boolean default false, p_anonymous boolean default false,
  p_closes_at timestamptz default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  t record; v_id uuid; v_opts text[]; i int;
  v_q text := btrim(coalesce(p_question, ''));
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  if num_nonnulls(p_event, p_post) <> 1 then return jsonb_build_object('error', 'invalid_target'); end if;
  select * into t from _crew_poll_target(p_event, p_post);
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
          p_closes_at, auth.uid())
  returning id into v_id;
  for i in 1..cardinality(v_opts) loop
    insert into crew_poll_options (poll_id, label, sort) values (v_id, v_opts[i], i);
  end loop;
  return _crew_poll_json(v_id);
end; $$;
grant execute on function public.crew_poll_create(uuid, uuid, text, text[], boolean, boolean, timestamptz) to authenticated;

-- ---------- 투표 (내 표를 통째로 바꾼다 — 빈 배열이면 취소) ------------------------
create or replace function public.crew_poll_vote(p_poll uuid, p_options uuid[])
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare pl record; t record; n int;
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  select * into pl from crew_polls where id = p_poll;
  if pl.id is null then return jsonb_build_object('error', 'not_found'); end if;
  select * into t from _crew_poll_target(pl.event_id, pl.post_id);
  if t.crew_id is null or not t.visible then return jsonb_build_object('error', 'not_found'); end if;
  if not is_crew_member(pl.crew_id) then return jsonb_build_object('error', 'not_member'); end if;
  if pl.closed_at is not null or (pl.closes_at is not null and pl.closes_at <= now()) then
    return jsonb_build_object('error', 'poll_closed');
  end if;
  n := coalesce(cardinality(p_options), 0);
  if n > 1 and not pl.multiple then return jsonb_build_object('error', 'single_choice'); end if;
  if n > 0 and (select count(*) from crew_poll_options o
                 where o.poll_id = p_poll and o.id = any(p_options)) <> (select count(distinct x) from unnest(p_options) x) then
    return jsonb_build_object('error', 'invalid_options');
  end if;
  delete from crew_poll_votes where poll_id = p_poll and user_id = auth.uid();
  if n > 0 then
    insert into crew_poll_votes (poll_id, option_id, user_id)
    select p_poll, x, auth.uid() from (select distinct x from unnest(p_options) x) s;
  end if;
  return _crew_poll_json(p_poll);
end; $$;
grant execute on function public.crew_poll_vote(uuid, uuid[]) to authenticated;

-- ---------- 마감 / 다시 열기 ---------------------------------------------------------
create or replace function public.crew_poll_set_closed(p_poll uuid, p_closed boolean)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare pl record;
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  select * into pl from crew_polls where id = p_poll;
  if pl.id is null then return jsonb_build_object('error', 'not_found'); end if;
  if not (pl.created_by = auth.uid() or is_crew_staff(pl.crew_id) or is_admin()) then
    return jsonb_build_object('error', 'not_allowed');
  end if;
  -- 다시 열 때 마감 시각이 이미 지났으면 마감 시각도 지운다(안 그러면 열어도 닫혀 있다)
  update crew_polls
     set closed_at = case when p_closed then now() else null end,
         closes_at = case when not p_closed and closes_at is not null and closes_at <= now()
                          then null else closes_at end
   where id = p_poll;
  return _crew_poll_json(p_poll);
end; $$;
grant execute on function public.crew_poll_set_closed(uuid, boolean) to authenticated;

-- ---------- 삭제 -----------------------------------------------------------------
create or replace function public.crew_poll_delete(p_poll uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare pl record;
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  select * into pl from crew_polls where id = p_poll;
  if pl.id is null then return jsonb_build_object('error', 'not_found'); end if;
  if not (pl.created_by = auth.uid() or is_crew_staff(pl.crew_id) or is_admin()) then
    return jsonb_build_object('error', 'not_allowed');
  end if;
  delete from crew_polls where id = p_poll;
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function public.crew_poll_delete(uuid) to authenticated;

-- ---------- 가드 -----------------------------------------------------------------
-- 실제 크루원 시점으로 만들고·투표하고·익명·마감·권한을 확인한 뒤 예외로 되감는다(운영 데이터 무변경).
do $$
declare
  v_crew uuid; v_staff uuid; v_member uuid; v_out uuid; v_event uuid;
  j jsonb; v_poll uuid; o1 uuid; o2 uuid;
begin
  -- 헬퍼는 누구에게도 열려 있으면 안 된다
  if has_function_privilege('anon', 'public._crew_poll_target(uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._crew_poll_json(uuid)', 'execute') then
    raise exception '가드: 내부 헬퍼가 클라이언트에 열려 있습니다';
  end if;
  if has_function_privilege('anon', 'public.crew_poll_vote(uuid, uuid[])', 'execute') then
    raise exception '가드: 투표가 익명 실행 가능합니다';
  end if;

  select m.crew_id, m.user_id into v_crew, v_staff
    from crew_members m where m.status = 'active' and m.role in ('owner','coach') limit 1;
  if v_crew is null then raise notice '가드 건너뜀: 운영진 없음'; return; end if;
  select m.user_id into v_member from crew_members m
   where m.crew_id = v_crew and m.status = 'active' and m.user_id <> v_staff limit 1;
  select p.id into v_out from profiles p
   where not exists (select 1 from crew_members m where m.crew_id = v_crew and m.user_id = p.id)
     and not coalesce(p.is_admin, false) limit 1;

  begin
    insert into crew_events (crew_id, title, starts_at, created_by)
    values (v_crew, '가드 투표 모임', now() + interval '3 days', v_staff) returning id into v_event;

    -- 운영진이 만든다
    perform set_config('request.jwt.claims', json_build_object('sub', v_staff::text, 'role', 'authenticated')::text, true);
    j := crew_poll_create(v_event, null, '뒤풀이 어디?', array['고기', '치킨', '고기', ''], false, false, null);
    if j ? 'error' then raise exception '가드: 만들기 실패 %', j; end if;
    v_poll := (j->>'id')::uuid;
    if jsonb_array_length(j->'options') <> 2 then raise exception '가드: 중복·빈 선택지가 정리되지 않음 %', j->'options'; end if;
    o1 := (j->'options'->0->>'id')::uuid; o2 := (j->'options'->1->>'id')::uuid;

    -- 단일 선택에 두 개는 거절, 하나는 통과, 바꾸기도 통과
    j := crew_poll_vote(v_poll, array[o1, o2]);
    if j->>'error' is distinct from 'single_choice' then raise exception '가드: 단일 선택 제한 실패 %', j; end if;
    j := crew_poll_vote(v_poll, array[o1]);
    if (j->'options'->0->>'votes')::int <> 1 then raise exception '가드: 투표 집계 %', j; end if;
    j := crew_poll_vote(v_poll, array[o2]);
    if (j->'options'->0->>'votes')::int <> 0 or (j->'options'->1->>'votes')::int <> 1 then
      raise exception '가드: 표 바꾸기 %', j;
    end if;

    -- 일반 크루원은 모임 투표를 만들 수 없지만 투표는 한다
    if v_member is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', v_member::text, 'role', 'authenticated')::text, true);
      j := crew_poll_create(v_event, null, 'x', array['a','b'], false, false, null);
      if j->>'error' is distinct from 'not_allowed' then raise exception '가드: 크루원이 모임 투표를 만듦 %', j; end if;
      j := crew_poll_vote(v_poll, array[o2]);
      if (j->>'voters')::int <> 2 then raise exception '가드: 투표자 수 %', j->>'voters'; end if;
      j := crew_poll_set_closed(v_poll, true);
      if j->>'error' is distinct from 'not_allowed' then raise exception '가드: 크루원이 마감함 %', j; end if;
    end if;

    -- 크루 밖 사람은 투표할 수 없다
    if v_out is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', v_out::text, 'role', 'authenticated')::text, true);
      j := crew_poll_vote(v_poll, array[o1]);
      if not (j ? 'error') then raise exception '가드: 크루 밖 사람이 투표함 %', j; end if;
    end if;

    -- 익명이면 이름이 내려가지 않는다
    perform set_config('request.jwt.claims', json_build_object('sub', v_staff::text, 'role', 'authenticated')::text, true);
    update crew_polls set anonymous = true where id = v_poll;
    j := _crew_poll_json(v_poll);
    if jsonb_array_length(j->'options'->1->'names') <> 0 then raise exception '가드: 익명인데 이름이 내려감'; end if;

    -- 마감하면 투표가 막히고, 다시 열면 된다
    j := crew_poll_set_closed(v_poll, true);
    j := crew_poll_vote(v_poll, array[o1]);
    if j->>'error' is distinct from 'poll_closed' then raise exception '가드: 마감 후 투표됨 %', j; end if;
    j := crew_poll_set_closed(v_poll, false);
    j := crew_poll_vote(v_poll, array[o1]);
    if j ? 'error' then raise exception '가드: 다시 연 뒤 투표 실패 %', j; end if;

    perform set_config('request.jwt.claims', null, true);
    raise exception 'guard_ok';
  exception when raise_exception then
    perform set_config('request.jwt.claims', null, true);
    if sqlerrm <> 'guard_ok' then raise; end if;
  end;
end $$;
